// Vision judgment — single enforcer for all image judgments in this service.
// [LAW:single-enforcer] All vision calls go through judgeCandidate. Provider
// selection (zai | openai) is config flowing in as a value; the pipeline
// never imports openai.ts or calls any provider directly.

import { spawn } from 'node:child_process'
import { judgeCandidateOpenAi } from './openai.js'

export type VisionProvider = 'zai' | 'openai'
export type VisionConfig = { provider: VisionProvider; apiKey: string }

export type JudgmentResult = {
  score: number
  reaction: string
}

// Returns { score, reaction } or null on any failure. null causes the pipeline
// to treat the candidate as below-threshold rather than aborting the pass.
export async function judgeCandidate(opts: {
  imageUrl: string
  pageUrl: string
  title: string
  personaPrompt: string
  vision: VisionConfig
}): Promise<JudgmentResult | null> {
  if (opts.vision.provider === 'openai') {
    return judgeCandidateOpenAi({
      imageUrl: opts.imageUrl,
      pageUrl: opts.pageUrl,
      title: opts.title,
      personaPrompt: opts.personaPrompt,
      apiKey: opts.vision.apiKey,
    })
  }
  return judgeCandidateZai({
    imageUrl: opts.imageUrl,
    pageUrl: opts.pageUrl,
    title: opts.title,
    personaPrompt: opts.personaPrompt,
    apiKey: opts.vision.apiKey,
  })
}

async function judgeCandidateZai(opts: {
  imageUrl: string
  pageUrl: string
  title: string
  personaPrompt: string
  apiKey: string
}): Promise<JudgmentResult | null> {
  const { imageUrl, pageUrl, title, personaPrompt, apiKey } = opts

  const prompt = [
    personaPrompt,
    '',
    `You are reviewing an AI-generated image found at: ${pageUrl}`,
    `Title: ${title}`,
    '',
    'Score this image from 0 to 100 based on how interesting, surprising, or compelling it is as AI-generated content for SlopSpot.',
    '',
    'Respond with ONLY:',
    '- First line: a single integer (0–100)',
    '- Second line (optional): a one-sentence reaction in your persona voice',
  ].join('\n')

  let reply: string
  try {
    reply = await callMcpImageAnalysis({ imageUrl, prompt, apiKey })
  } catch (err) {
    console.warn('discoverer: MCP analyze_image failed', { imageUrl, err: String(err) })
    return null
  }

  const lines = reply.trim().split('\n')
  const score = parseInt(lines[0].trim(), 10)
  if (isNaN(score) || score < 0 || score > 100) {
    console.warn('discoverer: unparseable score from MCP', { reply: reply.slice(0, 200) })
    return null
  }

  const reaction = lines[1]?.trim() ?? ''
  return { score, reaction }
}

// Spawn @z_ai/mcp-server, send initialize + tools/call(analyze_image), collect
// the text response. The process is killed after the response arrives.
async function callMcpImageAnalysis(opts: {
  imageUrl: string
  prompt: string
  apiKey: string
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'node_modules/.bin/zai-mcp-server',
      [],
      {
        env: {
          ...process.env,
          Z_AI_API_KEY: opts.apiKey,
          Z_AI_MODE: 'ZAI',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )

    let stdoutBuf = ''
    let initDone = false
    let requestId = 1

    // settle ensures the promise is resolved/rejected at most once regardless of
    // which event fires first (tool response, process close, or timeout).
    let settled = false
    let timeout: ReturnType<typeof setTimeout>
    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      fn()
    }

    const send = (msg: object) => {
      proc.stdin.write(JSON.stringify(msg) + '\n')
    }

    const handleLine = (line: string) => {
      let msg: { id?: number; result?: unknown; error?: unknown }
      try {
        msg = JSON.parse(line) as typeof msg
      } catch {
        return
      }

      if (!initDone && msg.id === 1) {
        // initialize response received — must send notifications/initialized
        // before any tool calls (required by MCP spec)
        initDone = true
        send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        requestId = 2
        send({
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/call',
          params: {
            name: 'analyze_image',
            arguments: {
              image_source: opts.imageUrl,
              prompt: opts.prompt,
            },
          },
        })
        return
      }

      if (msg.id === requestId) {
        proc.kill()
        if (msg.error) {
          settle(() => reject(new Error(`MCP tool error: ${JSON.stringify(msg.error)}`)))
          return
        }
        // result.content is an array of { type: 'text', text: string }
        const content = (msg.result as { content?: Array<{ type: string; text?: string }> })
          ?.content
        const text = content?.find((c) => c.type === 'text')?.text ?? ''
        settle(() => resolve(text))
      }
    }

    proc.stdout.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString()
      const lines = stdoutBuf.split('\n')
      stdoutBuf = lines.pop() ?? ''
      lines.forEach(handleLine)
    })

    proc.stderr.on('data', (chunk: Buffer) => {
      // MCP servers log to stderr; suppress unless debugging
      const msg = chunk.toString().trim()
      if (msg) console.debug('mcp-server:', msg)
    })

    proc.on('error', (err) => settle(() => reject(err)))
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        settle(() => reject(new Error(`@z_ai/mcp-server exited with code ${code}`)))
      } else {
        settle(() => reject(new Error('@z_ai/mcp-server exited without sending a response')))
      }
    })

    timeout = setTimeout(() => {
      proc.kill()
      settle(() => reject(new Error('MCP analyze_image timed out')))
    }, 60_000)

    // Send initialize first
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'slopspot-discoverer', version: '1.0.0' },
      },
    })
  })
}
