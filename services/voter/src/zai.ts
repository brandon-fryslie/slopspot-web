// Vision scoring via the @z_ai/mcp-server MCP package (stdio transport).
// [LAW:single-enforcer] All vision calls in this service go through
// judgeImage — spawning the MCP server and calling analyze_image happens
// exactly once, here.
//
// The GLM Coding Plan is for use within supported coding tools ONLY. We invoke
// @z_ai/mcp-server as a subprocess (stdio MCP) — the same mechanism Claude Code
// and Goose use — rather than calling z.ai APIs directly. Direct HTTP calls to
// any z.ai endpoint from automated services violate TOS.

import { spawn } from 'node:child_process'

// Returns a score 0–100, or null if the MCP call fails or returns an
// unparseable response. null causes the pipeline to skip this candidate.
export async function judgeImage(opts: {
  imageUrl: string
  personaPrompt: string
  apiKey: string
}): Promise<number | null> {
  const { imageUrl, personaPrompt, apiKey } = opts

  const prompt = [
    personaPrompt,
    '',
    'Rate this AI-generated image on a scale of 0 to 100 based on your aesthetic criteria.',
    'Reply with ONLY a single integer between 0 and 100. No other text.',
  ].join('\n')

  let reply: string
  try {
    reply = await callMcpImageAnalysis({ imageUrl, prompt, apiKey })
  } catch (err) {
    console.warn('voter: MCP analyze_image failed', { imageUrl, err: String(err) })
    return null
  }

  // [LAW:types-are-the-program] Strict parse: only a bare decimal integer is
  // accepted. parseInt('85/100') = 85 — partial strings would silently bypass
  // the prompt's "ONLY a single integer" contract.
  const trimmed = reply.trim().split('\n')[0].trim()
  const parsed = /^\d{1,3}$/.test(trimmed) ? parseInt(trimmed, 10) : NaN
  if (isNaN(parsed) || parsed < 0 || parsed > 100) {
    console.warn('voter: unparseable score from MCP', { reply: reply.slice(0, 200) })
    return null
  }
  return parsed
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
