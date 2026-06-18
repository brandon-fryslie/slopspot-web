// [LAW:behavior-not-structure][LAW:verifiable-goals] Pins THE GATE: while WELL_REACHABLE is
// false (app/lib/well-gate.ts), /api/well does not exist — every request is 404, returned
// BEFORE any same-origin, budget, seating, or authoring side effect. This is the release-block
// the CD set against the literal-echo "vending machine" Well (2026-06-18): a well-formed wish
// must NOT author a slop while the surface is gated.
//
// Deliberately does NOT mock ~/lib/well-gate, so it reads the REAL gate value (false). When the
// Well's soul is verified and WELL_REACHABLE is flipped true, this file is removed with the gate.
import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { action } from '~/routes/api.well'

const stubCtx: ExecutionContext = {
  waitUntil() {},
  passThroughOnException() {},
  exports: {} as Cloudflare.Exports,
  props: {},
}

function gatedReq(method: string): Parameters<typeof action>[0] {
  const url = new URL('https://slopspot.ai/api/well')
  return {
    params: {},
    context: { cloudflare: { env, ctx: stubCtx } },
    request: new Request(url, {
      method,
      body: method === 'POST' ? JSON.stringify({ wish: 'a fox in a library' }) : undefined,
      headers: { 'content-type': 'application/json', origin: 'https://slopspot.ai' },
    }),
    url,
    pattern: '/api/well',
  } as Parameters<typeof action>[0]
}

describe('POST /api/well - gated closed', () => {
  it('returns 404 for a well-formed, same-origin wish while the Well is gated (no slop authored)', async () => {
    const res = await action(gatedReq('POST'))
    expect(res.status).toBe(404)
  })

  it('returns 404 for a GET too — the channel does not exist while gated', async () => {
    const res = await action(gatedReq('GET'))
    expect(res.status).toBe(404)
  })
})
