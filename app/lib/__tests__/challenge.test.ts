import { describe, it, expect, vi } from 'vitest'
import { issueChallenge, verifyChallenge, CHALLENGE_TTL_MS, ChallengeBankEmptyError } from '~/lib/challenge'

const SECRET = 'test-secret-for-unit-tests'
const FAKE_ENTRY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const FAKE_BRIEFING = 'Test briefing: write a lipogram omitting the letter e, with word count mod 5 = 2.'

function makeEnv(overrides: Partial<{ bankEmpty: boolean; secret: string }> = {}): Env {
  const { bankEmpty = false, secret = SECRET } = overrides
  const store = new Map<string, string>()
  if (!bankEmpty) {
    store.set('manifest', JSON.stringify({ ids: [FAKE_ENTRY_ID] }))
    store.set(FAKE_ENTRY_ID, JSON.stringify({
      id: FAKE_ENTRY_ID,
      briefingText: FAKE_BRIEFING,
      easyForm: { kind: 'word_count_modulo', divisor: 5, residue: 2 },
      hardForm: { kind: 'lipogram', forbidden: 'e' },
      generatedAt: Date.now(),
    }))
  }
  return {
    SLOPSPOT_CHALLENGE_SECRET: secret,
    CHALLENGE_BANK: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(),
    } as unknown as KVNamespace,
  } as unknown as Env
}

// ─── CHALLENGE_TTL_MS constant ────────────────────────────────────────────────

it('CHALLENGE_TTL_MS is 240 seconds', () => {
  expect(CHALLENGE_TTL_MS).toBe(240_000)
})

// ─── issueChallenge ───────────────────────────────────────────────────────────

describe('issueChallenge', () => {
  it('returns a signed challengeId, the entry briefingText, and expiresAt', async () => {
    const now = Date.now()
    const result = await issueChallenge(makeEnv(), now)
    expect(result.challengeId).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(result.text).toBe(FAKE_BRIEFING)
    expect(new Date(result.expiresAt).getTime()).toBe(now + CHALLENGE_TTL_MS)
  })

  it('throws when SLOPSPOT_CHALLENGE_SECRET is empty', async () => {
    await expect(issueChallenge(makeEnv({ secret: '' }))).rejects.toThrow(
      'SLOPSPOT_CHALLENGE_SECRET is not configured',
    )
  })

  it('throws ChallengeBankEmptyError when bank has no manifest', async () => {
    await expect(issueChallenge(makeEnv({ bankEmpty: true }))).rejects.toThrow(
      ChallengeBankEmptyError,
    )
  })

  it('retries when manifest contains an expired entry — shuffle guarantees distinct picks', async () => {
    const GOOD_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
    const store = new Map<string, string>([
      ['manifest', JSON.stringify({ ids: [FAKE_ENTRY_ID, GOOD_ID] })],
      // FAKE_ENTRY_ID deliberately absent — simulates a KV entry that expired
      [GOOD_ID, JSON.stringify({ id: GOOD_ID, briefingText: 'good briefing', generatedAt: 1 })],
    ])
    const env = {
      SLOPSPOT_CHALLENGE_SECRET: SECRET,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        put: vi.fn(),
      } as unknown as KVNamespace,
    } as unknown as Env

    // Shuffle guarantees both IDs are tried; regardless of order, GOOD_ID is found
    const result = await issueChallenge(env)
    expect(result.text).toBe('good briefing')
  })
})

// ─── verifyChallenge ──────────────────────────────────────────────────────────

describe('verifyChallenge', () => {
  it('returns ok:true with entryId for a valid token', async () => {
    const { challengeId } = await issueChallenge(makeEnv())
    const result = await verifyChallenge(challengeId, '', SECRET)
    expect(result).toEqual({ ok: true, entryId: FAKE_ENTRY_ID })
  })

  it('ignores the acknowledgement argument — no wrong_ack path', async () => {
    const { challengeId } = await issueChallenge(makeEnv())
    const result = await verifyChallenge(challengeId, 'anything at all', SECRET)
    expect(result).toEqual({ ok: true, entryId: FAKE_ENTRY_ID })
  })

  it('returns invalid_signature for a tampered token', async () => {
    const { challengeId } = await issueChallenge(makeEnv())
    const tampered = challengeId.slice(0, -3) + 'abc'
    expect(await verifyChallenge(tampered, '', SECRET)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    })
  })

  it('returns invalid_signature when verified with the wrong secret', async () => {
    const { challengeId } = await issueChallenge(makeEnv())
    expect(await verifyChallenge(challengeId, '', 'wrong-secret')).toEqual({
      ok: false,
      reason: 'invalid_signature',
    })
  })

  it('returns malformed for a token with no dot separator', async () => {
    expect(await verifyChallenge('nodothere', '', SECRET)).toEqual({
      ok: false,
      reason: 'malformed',
    })
  })

  it('returns invalid_signature for a token with garbage payload (HMAC check fires first)', async () => {
    expect(await verifyChallenge('!!!.invalidsig', '', SECRET)).toEqual({
      ok: false,
      reason: 'invalid_signature',
    })
  })

  it('returns expired when the token is past its TTL', async () => {
    const pastTs = Date.now() - CHALLENGE_TTL_MS - 1
    const { challengeId } = await issueChallenge(makeEnv(), pastTs)
    expect(await verifyChallenge(challengeId, '', SECRET)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('handles base64url payloads requiring all three padding lengths', async () => {
    // Payload = {"entryId":"<36>","nonce":"<36>","issuedAt":<N>}
    // With entryId = FAKE_ENTRY_ID (36 chars) and nonce (36 chars):
    //   now=1 → 109 bytes → 109%3=1 → strip 2 '=' → url_len%4=2
    //   now=10 → 110 bytes → 110%3=2 → strip 1 '=' → url_len%4=3
    //   now=100 → 111 bytes → 111%3=0 → no padding → url_len%4=0
    const cases = [1, 10, 100]
    const seen = new Set<number>()
    for (const now of cases) {
      const { challengeId } = await issueChallenge(makeEnv(), now)
      const payloadB64 = challengeId.slice(0, challengeId.lastIndexOf('.'))
      seen.add(payloadB64.length % 4)
      const result = await verifyChallenge(challengeId, '', SECRET, now)
      expect(result.ok, `now=${now} payloadLen%4=${payloadB64.length % 4}`).toBe(true)
    }
    expect(seen.size).toBe(3)
  })

  it('throws when secret is empty', async () => {
    const { challengeId } = await issueChallenge(makeEnv())
    await expect(verifyChallenge(challengeId, '', '')).rejects.toThrow(
      'SLOPSPOT_CHALLENGE_SECRET is not configured',
    )
  })

  it('returns malformed for a HMAC-valid payload with missing issuedAt (NaN bypass guard)', async () => {
    // Craft a signed token whose payload has issuedAt removed — would bypass TTL as NaN > number === false
    const corruptPayload = { entryId: FAKE_ENTRY_ID, nonce: 'test' } // no issuedAt
    const corruptJson = JSON.stringify(corruptPayload)
    const b64 = btoa(corruptJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64))
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const result = await verifyChallenge(`${b64}.${sig}`, '', SECRET)
    expect(result).toEqual({ ok: false, reason: 'malformed' })
  })

  it('returns malformed for a HMAC-valid payload with missing entryId', async () => {
    const corruptPayload = { nonce: 'test', issuedAt: Date.now() } // no entryId
    const corruptJson = JSON.stringify(corruptPayload)
    const b64 = btoa(corruptJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64))
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const result = await verifyChallenge(`${b64}.${sig}`, '', SECRET)
    expect(result).toEqual({ ok: false, reason: 'malformed' })
  })

  it('returns malformed for a HMAC-valid payload with empty entryId', async () => {
    const corruptPayload = { entryId: '   ', nonce: 'test', issuedAt: Date.now() } // whitespace-only entryId
    const corruptJson = JSON.stringify(corruptPayload)
    const b64 = btoa(corruptJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64))
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const result = await verifyChallenge(`${b64}.${sig}`, '', SECRET)
    expect(result).toEqual({ ok: false, reason: 'malformed' })
  })
})
