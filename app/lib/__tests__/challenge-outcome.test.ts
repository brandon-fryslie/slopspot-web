import { describe, it, expect } from 'vitest'
import { outcomeToResponse } from '~/lib/challenge-outcome'

async function body(r: Response) {
  return r.json() as Promise<Record<string, unknown>>
}

describe('outcomeToResponse', () => {
  it('generated → 200 with postId', async () => {
    const r = outcomeToResponse({ kind: 'generated', postId: 'post-abc' })
    expect(r.status).toBe(200)
    expect(await body(r)).toEqual({ postId: 'post-abc' })
  })

  it('token_invalid → 401 with hint', async () => {
    const r = outcomeToResponse({ kind: 'token_invalid' })
    expect(r.status).toBe(401)
    const b = await body(r)
    expect(b.error).toMatch(/invalid/)
    expect(typeof b.hint).toBe('string')
  })

  it('token_expired → 401 with 240s TTL message and hint', async () => {
    const r = outcomeToResponse({ kind: 'token_expired' })
    expect(r.status).toBe(401)
    const b = await body(r)
    expect(b.error).toMatch(/240s TTL/)
    expect(typeof b.hint).toBe('string')
  })

  it('bank_entry_missing → 503 and entryId absent from body', async () => {
    const r = outcomeToResponse({ kind: 'bank_entry_missing', entryId: 'entry-xyz' })
    expect(r.status).toBe(503)
    const b = await body(r)
    expect(b.entryId).toBeUndefined()
    expect(b.error).toMatch(/bank/)
  })

  it('form_violation easy → 403 with positional error and detail', async () => {
    const r = outcomeToResponse({ kind: 'form_violation', which: 'easy', detail: 'word 3 must start with Q' })
    expect(r.status).toBe(403)
    const b = await body(r)
    expect(b.error).toMatch(/positional/)
    expect(b.detail).toBe('word 3 must start with Q')
  })

  it('form_violation hard → 403 with creative error and detail', async () => {
    const r = outcomeToResponse({ kind: 'form_violation', which: 'hard', detail: 'lipogram violated: found letter e' })
    expect(r.status).toBe(403)
    const b = await body(r)
    expect(b.error).toMatch(/creative/)
    expect(b.detail).toBe('lipogram violated: found letter e')
  })

  it('secret_gate_failed → 403 and gate name absent from body', async () => {
    const r = outcomeToResponse({ kind: 'secret_gate_failed', gate: 'dictionary_word_ratio' })
    expect(r.status).toBe(403)
    const b = await body(r)
    expect(b.gate).toBeUndefined()
    expect(typeof b.error).toBe('string')
    // body must not leak any mechanism detail
    expect(JSON.stringify(b)).not.toMatch(/dictionary_word_ratio/)
  })

  it('quota_exhausted → 429 with retryAfter', async () => {
    const retryAfter = '2026-05-18T00:00:00.000Z'
    const r = outcomeToResponse({ kind: 'quota_exhausted', retryAfter })
    expect(r.status).toBe(429)
    const b = await body(r)
    expect(b.error).toMatch(/quota/)
    expect(b.retryAfter).toBe(retryAfter)
  })

  it('all responses have Content-Type application/json', () => {
    const outcomes = [
      outcomeToResponse({ kind: 'generated', postId: 'x' }),
      outcomeToResponse({ kind: 'token_invalid' }),
      outcomeToResponse({ kind: 'token_expired' }),
      outcomeToResponse({ kind: 'bank_entry_missing', entryId: 'e' }),
      outcomeToResponse({ kind: 'form_violation', which: 'easy', detail: 'd' }),
      outcomeToResponse({ kind: 'form_violation', which: 'hard', detail: 'd' }),
      outcomeToResponse({ kind: 'secret_gate_failed', gate: 'g' }),
      outcomeToResponse({ kind: 'quota_exhausted', retryAfter: '2026-05-18T00:00:00.000Z' }),
    ]
    for (const r of outcomes) {
      expect(r.headers.get('Content-Type')).toBe('application/json')
    }
  })
})
