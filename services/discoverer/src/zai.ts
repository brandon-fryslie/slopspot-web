// Vision judgment via the @z_ai/mcp-server MCP package (stdio transport).
// [LAW:single-enforcer] All vision calls in this service go through
// judgeCandidate — spawning the MCP server and calling image_analysis happens
// exactly once, here.
//
// The GLM Coding Plan is for use within supported coding tools ONLY. We invoke
// @z_ai/mcp-server as a subprocess (stdio MCP) — the same mechanism Claude Code
// and Goose use — rather than calling z.ai APIs directly. Direct HTTP calls to
// any z.ai endpoint from automated services violate TOS.

import { spawn } from 'node:child_process'

export type JudgmentResult = {
  score: number
  reaction: string
}

// Spawn @z_ai/mcp-server, send one image_analysis call via stdio MCP protocol,
// return the parsed score+reaction. Returns null on any failure so the pipeline
// treats the candidate as below-threshold rather than aborting the pass.
export async function judgeCandidate(opts: {
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
    console.warn('discoverer: MCP image_analysis failed', { imageUrl, err: String(err) })
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

// Spawn @z_ai/mcp-server, send initialize + tools/call(image_analysis), collect
// the text response. The process is killed after the response arrives.
async function callMcpImageAnalysis(opts: {
  imageUrl: string
  prompt: string
  apiKey: string
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'npx',
      ['--yes', '@z_ai/mcp-server@latest'],
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
          reject(new Error(`MCP tool error: ${JSON.stringify(msg.error)}`))
          return
        }
        // result.content is an array of { type: 'text', text: string }
        const content = (msg.result as { content?: Array<{ type: string; text?: string }> })
          ?.content
        const text = content?.find((c) => c.type === 'text')?.text ?? ''
        resolve(text)
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

    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => {
      if (code !== 0 && code !== null) {
        reject(new Error(`@z_ai/mcp-server exited with code ${code}`))
      }
    })

    const TIMEOUT_MS = 60_000
    const timeout = setTimeout(() => {
      proc.kill()
      reject(new Error('MCP image_analysis timed out'))
    }, TIMEOUT_MS)
    proc.on('close', () => clearTimeout(timeout))

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
