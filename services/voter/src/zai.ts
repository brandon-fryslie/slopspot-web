// Vision scoring — single enforcer for all image judgments in this service.
// [LAW:single-enforcer] All vision calls go through judgeImage. Provider
// selection (zai | openai) is config flowing in as a value; the pipeline
// never imports openai.ts or calls any provider directly.

import { spawn } from 'node:child_process'
import { judgeImageOpenAi } from './openai.js'

export type VisionProvider = 'zai' | 'openai'
export type VisionConfig = { provider: VisionProvider; apiKey: string }

export type Judgment = { score: number; reasoning: string }

// Returns { score, reasoning } or null on any failure. null causes the
// pipeline to skip this candidate. [LAW:types-are-the-program] — both fields
// are always present together; the type forbids "score without reasoning."
export async function judgeImage(opts: {
  imageUrl: string
  personaPrompt: string
  vision: VisionConfig
}): Promise<Judgment | null> {
  if (opts.vision.provider === 'openai') {
    return judgeImageOpenAi({
      imageUrl: opts.imageUrl,
      personaPrompt: opts.personaPrompt,
      apiKey: opts.vision.apiKey,
    })
  }
  return judgeImageZai({
    imageUrl: opts.imageUrl,
    personaPrompt: opts.personaPrompt,
    apiKey: opts.vision.apiKey,
  })
}

async function judgeImageZai(opts: {
  imageUrl: string
  personaPrompt: string
  apiKey: string
}): Promise<Judgment | null> {
  const { imageUrl, personaPrompt, apiKey } = opts

  const prompt = [
    personaPrompt,
    '',
    'Rate this AI-generated image on a scale of 0 to 100 based on your aesthetic criteria.',
    'Reply with exactly two lines:',
    'Line 1: a single integer between 0 and 100.',
    'Line 2: one sentence explaining your rating.',
  ].join('\n')

  let reply: string
  try {
    reply = await callMcpImageAnalysis({ imageUrl, prompt, apiKey })
  } catch (err) {
    console.warn('voter: MCP analyze_image failed', { imageUrl, err: String(err) })
    return null
  }

  const lines = reply.trim().split('\n').map((l) => l.trim()).filter(Boolean)
  const scoreLine = lines[0] ?? ''
  const reasoningLine = lines[1] ?? ''

  // [LAW:types-are-the-program] Strict parse: score and reasoning must both
  // be present — a missing reasoning line is treated as unparseable rather
  // than fabricated.
  const parsed = /^\d{1,3}$/.test(scoreLine) ? parseInt(scoreLine, 10) : NaN
  if (isNaN(parsed) || parsed < 0 || parsed > 100 || !reasoningLine) {
    console.warn('voter: unparseable response from MCP', { reply: reply.slice(0, 200) })
    return null
  }
  return { score: parsed, reasoning: reasoningLine }
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

    // settle ensures the promise is resolved/rejected at most once regardless
    // of which event fires first (tool response, process close, or timeout).
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

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'slopspot-voter', version: '1.0.0' },
      },
    })
  })
}
