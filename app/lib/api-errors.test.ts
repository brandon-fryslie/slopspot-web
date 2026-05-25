import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { invalidBodyResponse } from './api-errors'

describe('invalidBodyResponse', () => {
  it('returns 400 + structured issues for a ZodError', async () => {
    const schema = z.object({ body: z.string().min(1) })
    let caught: unknown
    try {
      schema.parse({ body: '' })
    } catch (e) {
      caught = e
    }
    const res = invalidBodyResponse(caught, 'hint text')
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string; issues: unknown[]; hint: string }
    expect(json.error).toBe('invalid body')
    expect(json.hint).toBe('hint text')
    expect(Array.isArray(json.issues)).toBe(true)
    expect(json.issues.length).toBeGreaterThan(0)
  })

  it('returns 400 + hint only for a non-Zod error (no String(e) leak)', async () => {
    const res = invalidBodyResponse(new Error('SyntaxError: Unexpected token } at runtime/v8/internal'), 'hint text')
    expect(res.status).toBe(400)
    const json = (await res.json()) as Record<string, unknown>
    expect(json.error).toBe('invalid body')
    expect(json.hint).toBe('hint text')
    // The raw exception message must not appear in the body — that was the
    // recon-leak the original `String(e)` shape produced.
    expect(JSON.stringify(json)).not.toContain('runtime/v8/internal')
    expect(json).not.toHaveProperty('detail')
  })

  it('returns 400 + hint only for an arbitrary thrown value', async () => {
    const res = invalidBodyResponse('plain string thrown', 'hint text')
    const json = (await res.json()) as Record<string, unknown>
    expect(JSON.stringify(json)).not.toContain('plain string thrown')
    expect(json).not.toHaveProperty('detail')
    expect(json).not.toHaveProperty('issues')
  })
})
