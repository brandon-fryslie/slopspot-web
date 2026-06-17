// [LAW:behavior-not-structure] Pins the fork/breed error WIRE CONTRACT: each cause carries an
// honest HTTP status, and the client parses the cause back out of the body — or falls to null
// (the quiet unknown pause) when there is no usable signal, never a guessed cause.

import { describe, it, expect } from 'vitest'
import {
  FORK_ERROR_CAUSES,
  FORK_ERROR_STATUS,
  forkErrorResponse,
  parseForkErrorCause,
} from '~/lib/fork-error'

describe('forkErrorResponse — a cause emits its honest status and a machine-readable body', () => {
  it.each([...FORK_ERROR_CAUSES])('emits cause %s with its mapped status', async (cause) => {
    const res = forkErrorResponse(cause, 'dev message', { providerId: 'p' })
    expect(res.status).toBe(FORK_ERROR_STATUS[cause])
    const body = (await res.json()) as { cause: string; error: string; providerId: string }
    expect(body.cause).toBe(cause)
    expect(body.error).toBe('dev message')
    expect(body.providerId).toBe('p')
  })

  it('keeps the overloaded statuses honest: 502 splits, 422 keeps distinct causes', () => {
    // [LAW:no-silent-failure] The transient upstream failure (502) and the deterministic server
    // fault (500) are DIFFERENT statuses now — the conflation this ticket fixes.
    expect(FORK_ERROR_STATUS['provider-upstream']).toBe(502)
    expect(FORK_ERROR_STATUS['internal']).toBe(500)
    // 422's two causes share a status but are distinct CAUSES (the unambiguous signal).
    expect(FORK_ERROR_STATUS['provider-unavailable']).toBe(422)
    expect(FORK_ERROR_STATUS['invalid-params']).toBe(422)
    expect('provider-unavailable').not.toBe('invalid-params')
  })
})

describe('parseForkErrorCause — read an unambiguous cause out of an error body', () => {
  it.each([...FORK_ERROR_CAUSES])('recovers cause %s from a tagged body', (cause) => {
    expect(parseForkErrorCause({ cause, error: 'x' })).toBe(cause)
  })

  it('returns null for a body with no usable cause signal', () => {
    // [LAW:no-silent-failure] A framework 500 page, an edge error, a network failure, or a
    // junk tag — none carries a known cause, so the client gets null (→ quiet unknown), never
    // a guessed cause that would mislabel the pause.
    for (const body of [null, undefined, {}, { cause: 'not-a-real-cause' }, 'plain text', 42]) {
      expect(parseForkErrorCause(body), JSON.stringify(body)).toBeNull()
    }
  })
})
