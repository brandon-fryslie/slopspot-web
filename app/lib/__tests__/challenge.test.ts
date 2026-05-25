import { describe, it, expect, vi } from 'vitest'
import { issueChallenge, verifyChallenge, CHALLENGE_TTL_MS, ChallengeBankEmptyError, ChallengeConfigError } from '~/lib/challenge'
import { DAILY_QUOTA } from '~/lib/quota'

const SECRET = 'test-secret-for-unit-tests'
const FAKE_ENTRY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const FAKE_BRIEFING = 'Test briefing: write a lipogram omitting the letter e, with word count mod 5 = 2.'

// A prompt that satisfies: word_count_modulo{divisor:5,residue:2} (7 words)
// AND lipogram{forbidden:'e'} (no letter 'e') AND all secret gates.
const VALID_PROMPT = 'bright cats jump high, cosmic stars glow'
// Fails easy form (5 words → 5%5=0, not 2)
const WRONG_WORD_COUNT_PROMPT = 'this prompt has wrong count'
// Fails hard form (contains 'e'): 7 words, word count mod 5 = 2
const HAS_FORBIDDEN_E_PROMPT = 'seven great words meet here now truly'
// Passes easy+hard but fails dictionary gate (gibberish, 7 words, no 'e')
const GIBBERISH_PROMPT = 'xqz mvk plt xr brbt zfg kml'

function makeMockDB(quotaFull = false) {
  const makeStmt = (): unknown => ({ bind: (..._args: unknown[]) => makeStmt() })
  return {
    prepare: vi.fn(() => makeStmt()),
    batch: vi.fn(async () => [
      { results: [] },
      { results: quotaFull ? [] : [{ count: 1 }] },
    ]),
  } as unknown as D1Database
}

function makeEnv(overrides: Partial<{
  bankEmpty: boolean
  secret: string
  quotaFull: boolean
  malformedEntry: boolean
}> = {}): Env {
  const { bankEmpty = false, secret = SECRET, quotaFull = false, malformedEntry = false } = overrides
  const store = new Map<string, string>()
  if (!bankEmpty) {
    store.set('manifest', JSON.stringify({ ids: [FAKE_ENTRY_ID] }))
    store.set(FAKE_ENTRY_ID, malformedEntry
      ? 'not-valid-json'
      : JSON.stringify({
          id: FAKE_ENTRY_ID,
          briefingText: FAKE_BRIEFING,
          easyForm: { kind: 'word_count_modulo', divisor: 5, residue: 2 },
          hardForm: { kind: 'lipogram', forbidden: 'e' },
          generatedAt: Date.now(),
        })
    )
  }
  return {
    SLOPSPOT_CHALLENGE_SECRET: secret,
    CHALLENGE_BANK: {
      get: vi.fn(async (key: string) => store.get(key) ?? null),
      put: vi.fn(),
    } as unknown as KVNamespace,
    DB: makeMockDB(quotaFull),
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

  it('throws malformed error when manifest value is empty string (not null)', async () => {
    const store = new Map<string, string>([['manifest', '']])
    const env = {
      SLOPSPOT_CHALLENGE_SECRET: SECRET,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        put: vi.fn(),
      } as unknown as KVNamespace,
    } as unknown as Env
    await expect(issueChallenge(env)).rejects.toThrow('challenge manifest is malformed')
  })

  it('throws malformed error when manifest contains whitespace-only IDs', async () => {
    const store = new Map<string, string>([
      ['manifest', JSON.stringify({ ids: ['   '] })],
    ])
    const env = {
      SLOPSPOT_CHALLENGE_SECRET: SECRET,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        put: vi.fn(),
      } as unknown as KVNamespace,
    } as unknown as Env
    await expect(issueChallenge(env)).rejects.toThrow('challenge manifest is malformed')
  })

  it('skips malformed KV entry JSON and uses another valid candidate', async () => {
    const GOOD_ID = 'cccccccc-dddd-eeee-ffff-000000000000'
    const store = new Map<string, string>([
      ['manifest', JSON.stringify({ ids: [FAKE_ENTRY_ID, GOOD_ID] })],
      [FAKE_ENTRY_ID, '{{{not valid json'],
      [GOOD_ID, JSON.stringify({ id: GOOD_ID, briefingText: 'good briefing from valid entry', easyForm: { kind: 'word_count_modulo', divisor: 5, residue: 2 }, hardForm: { kind: 'lipogram', forbidden: 'e' }, generatedAt: 1 })],
    ])
    const env = {
      SLOPSPOT_CHALLENGE_SECRET: SECRET,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        put: vi.fn(),
      } as unknown as KVNamespace,
    } as unknown as Env
    // Math.random → 0 keeps every Fisher-Yates swap a no-op, so ids stay [FAKE_ENTRY_ID, GOOD_ID]
    // and the malformed-skip branch is deterministically exercised before GOOD_ID is found
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      const result = await issueChallenge(env)
      expect(result.text).toBe('good briefing from valid entry')
      expect(env.CHALLENGE_BANK.get).toHaveBeenCalledWith(FAKE_ENTRY_ID)
    } finally {
      spy.mockRestore()
    }
  })

  it('skips entries missing easyForm or hardForm — issues from the next valid candidate', async () => {
    const GOOD_ID = 'ffffffff-eeee-dddd-cccc-bbbbbbbbbbbb'
    const store = new Map<string, string>([
      ['manifest', JSON.stringify({ ids: [FAKE_ENTRY_ID, GOOD_ID] })],
      // FAKE_ENTRY_ID has briefingText but no forms — should be skipped
      [FAKE_ENTRY_ID, JSON.stringify({ id: FAKE_ENTRY_ID, briefingText: 'text without forms', generatedAt: 1 })],
      [GOOD_ID, JSON.stringify({
        id: GOOD_ID,
        briefingText: 'good briefing with forms',
        easyForm: { kind: 'word_count_modulo', divisor: 5, residue: 2 },
        hardForm: { kind: 'lipogram', forbidden: 'e' },
        generatedAt: 1,
      })],
    ])
    const env = {
      SLOPSPOT_CHALLENGE_SECRET: SECRET,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        put: vi.fn(),
      } as unknown as KVNamespace,
    } as unknown as Env
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      const result = await issueChallenge(env)
      expect(result.text).toBe('good briefing with forms')
      expect(env.CHALLENGE_BANK.get).toHaveBeenCalledWith(FAKE_ENTRY_ID)
    } finally {
      spy.mockRestore()
    }
  })

  it('retries when manifest contains an expired entry — missing entry is skipped', async () => {
    const GOOD_ID = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
    const store = new Map<string, string>([
      ['manifest', JSON.stringify({ ids: [FAKE_ENTRY_ID, GOOD_ID] })],
      // FAKE_ENTRY_ID deliberately absent — simulates a KV entry that expired
      [GOOD_ID, JSON.stringify({ id: GOOD_ID, briefingText: 'good briefing', easyForm: { kind: 'word_count_modulo', divisor: 5, residue: 2 }, hardForm: { kind: 'lipogram', forbidden: 'e' }, generatedAt: 1 })],
    ])
    const env = {
      SLOPSPOT_CHALLENGE_SECRET: SECRET,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => store.get(key) ?? null),
        put: vi.fn(),
      } as unknown as KVNamespace,
    } as unknown as Env
    // Math.random → 0 keeps every Fisher-Yates swap a no-op, so ids stay [FAKE_ENTRY_ID, GOOD_ID]
    // and the expired-entry skip path is deterministically exercised before GOOD_ID is found
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      const result = await issueChallenge(env)
      expect(result.text).toBe('good briefing')
      expect(env.CHALLENGE_BANK.get).toHaveBeenCalledWith(FAKE_ENTRY_ID)
    } finally {
      spy.mockRestore()
    }
  })
})

// ─── verifyChallenge ──────────────────────────────────────────────────────────

describe('verifyChallenge', () => {
  it('returns verified with entryId for a valid token and valid prompt', async () => {
    const env = makeEnv()
    const { challengeId } = await issueChallenge(env)
    const result = await verifyChallenge(challengeId, VALID_PROMPT, env)
    expect(result).toEqual({ kind: 'verified', entryId: FAKE_ENTRY_ID })
  })

  it('returns token_invalid for a token with no dot separator', async () => {
    const env = makeEnv()
    expect(await verifyChallenge('nodothere', VALID_PROMPT, env)).toEqual({
      kind: 'token_invalid',
    })
  })

  it('returns token_invalid for a tampered token', async () => {
    const env = makeEnv()
    const { challengeId } = await issueChallenge(env)
    const tampered = challengeId.slice(0, -3) + 'abc'
    expect(await verifyChallenge(tampered, VALID_PROMPT, env)).toEqual({
      kind: 'token_invalid',
    })
  })

  it('returns token_invalid when verified with the wrong secret', async () => {
    const env = makeEnv()
    const { challengeId } = await issueChallenge(env)
    const wrongSecretEnv = makeEnv({ secret: 'wrong-secret' })
    // Use issueEnv token but verify with wrong secret env
    const wrongEnv = { ...wrongSecretEnv }
    expect(await verifyChallenge(challengeId, VALID_PROMPT, wrongEnv)).toEqual({
      kind: 'token_invalid',
    })
  })

  it('returns token_invalid for garbage payload (HMAC check fires first)', async () => {
    const env = makeEnv()
    expect(await verifyChallenge('!!!.invalidsig', VALID_PROMPT, env)).toEqual({
      kind: 'token_invalid',
    })
  })

  it('returns token_expired when the token is past its TTL', async () => {
    const env = makeEnv()
    const pastTs = Date.now() - CHALLENGE_TTL_MS - 1
    const { challengeId } = await issueChallenge(env, pastTs)
    expect(await verifyChallenge(challengeId, VALID_PROMPT, env)).toEqual({
      kind: 'token_expired',
    })
  })

  it('handles base64url payloads requiring all three padding lengths', async () => {
    const env = makeEnv()
    // now=1 → 109 bytes → url_len%4=2; now=10 → 110 bytes → url_len%4=3; now=100 → 111 bytes → url_len%4=0
    const cases = [1, 10, 100]
    const seen = new Set<number>()
    for (const now of cases) {
      const { challengeId } = await issueChallenge(env, now)
      const payloadB64 = challengeId.slice(0, challengeId.lastIndexOf('.'))
      seen.add(payloadB64.length % 4)
      const result = await verifyChallenge(challengeId, VALID_PROMPT, env, now)
      expect(result.kind, `now=${now} payloadLen%4=${payloadB64.length % 4}`).toBe('verified')
    }
    expect(seen.size).toBe(3)
  })

  it('returns bank_entry_missing when the KV entry is absent for a valid token', async () => {
    const env = makeEnv()
    const { challengeId } = await issueChallenge(env)
    // Remove the entry from the bank after issuing
    const emptyBankEnv = {
      ...env,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => key === 'manifest' ? null : null),
        put: vi.fn(),
      } as unknown as KVNamespace,
    }
    const result = await verifyChallenge(challengeId, VALID_PROMPT, emptyBankEnv as unknown as Env)
    expect(result.kind).toBe('bank_entry_missing')
  })

  it('returns bank_entry_missing when KV entry JSON is malformed', async () => {
    const goodEnv = makeEnv()
    const { challengeId } = await issueChallenge(goodEnv)
    const malformedEnv = {
      ...goodEnv,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => {
          if (key === 'manifest') return JSON.stringify({ ids: [FAKE_ENTRY_ID] })
          return 'not-valid-json'
        }),
        put: vi.fn(),
      } as unknown as KVNamespace,
    }
    const result = await verifyChallenge(challengeId, VALID_PROMPT, malformedEnv as unknown as Env)
    expect(result.kind).toBe('bank_entry_missing')
  })

  it('returns bank_entry_missing when bank entry has an unknown easyForm kind', async () => {
    const goodEnv = makeEnv()
    const { challengeId } = await issueChallenge(goodEnv)
    const unknownFormEnv = {
      ...goodEnv,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => {
          if (key === 'manifest') return JSON.stringify({ ids: [FAKE_ENTRY_ID] })
          return JSON.stringify({
            id: FAKE_ENTRY_ID,
            briefingText: FAKE_BRIEFING,
            easyForm: { kind: 'not_a_real_variant', foo: 'bar' },
            hardForm: { kind: 'lipogram', forbidden: 'e' },
            generatedAt: Date.now(),
          })
        }),
        put: vi.fn(),
      } as unknown as KVNamespace,
    }
    const result = await verifyChallenge(challengeId, VALID_PROMPT, unknownFormEnv as unknown as Env)
    expect(result.kind).toBe('bank_entry_missing')
  })

  it('returns bank_entry_missing when bank entry has an unknown hardForm kind', async () => {
    const goodEnv = makeEnv()
    const { challengeId } = await issueChallenge(goodEnv)
    const unknownFormEnv = {
      ...goodEnv,
      CHALLENGE_BANK: {
        get: vi.fn(async (key: string) => {
          if (key === 'manifest') return JSON.stringify({ ids: [FAKE_ENTRY_ID] })
          return JSON.stringify({
            id: FAKE_ENTRY_ID,
            briefingText: FAKE_BRIEFING,
            easyForm: { kind: 'word_count_modulo', divisor: 5, residue: 2 },
            hardForm: { kind: 'not_a_real_variant', foo: 'bar' },
            generatedAt: Date.now(),
          })
        }),
        put: vi.fn(),
      } as unknown as KVNamespace,
    }
    const result = await verifyChallenge(challengeId, VALID_PROMPT, unknownFormEnv as unknown as Env)
    expect(result.kind).toBe('bank_entry_missing')
  })

  it('returns form_violation{which:easy} when easy form is not satisfied', async () => {
    const env = makeEnv()
    const { challengeId } = await issueChallenge(env)
    const result = await verifyChallenge(challengeId, WRONG_WORD_COUNT_PROMPT, env)
    expect(result).toMatchObject({ kind: 'form_violation', which: 'easy' })
  })

  it('returns form_violation{which:hard} when hard form is not satisfied', async () => {
    const env = makeEnv()
    const { challengeId } = await issueChallenge(env)
    const result = await verifyChallenge(challengeId, HAS_FORBIDDEN_E_PROMPT, env)
    expect(result).toMatchObject({ kind: 'form_violation', which: 'hard' })
  })

  it('returns secret_gate_failed for form-valid gibberish that fails dictionary gate', async () => {
    const env = makeEnv()
    const { challengeId } = await issueChallenge(env)
    const result = await verifyChallenge(challengeId, GIBBERISH_PROMPT, env)
    expect(result).toMatchObject({ kind: 'secret_gate_failed' })
  })

  it('returns quota_exhausted when the daily quota is full', async () => {
    const env = makeEnv({ quotaFull: true })
    const { challengeId } = await issueChallenge(env)
    const result = await verifyChallenge(challengeId, VALID_PROMPT, env)
    expect(result.kind).toBe('quota_exhausted')
  })

  it('calls tryReserve (DB.batch) on successful form+gate pass', async () => {
    const env = makeEnv()
    const { challengeId } = await issueChallenge(env)
    await verifyChallenge(challengeId, VALID_PROMPT, env)
    expect(env.DB.batch).toHaveBeenCalledTimes(1)
  })

  it('does not call tryReserve when form verification fails', async () => {
    const env = makeEnv()
    const { challengeId } = await issueChallenge(env)
    await verifyChallenge(challengeId, WRONG_WORD_COUNT_PROMPT, env)
    expect(env.DB.batch).not.toHaveBeenCalled()
  })

  it('throws ChallengeConfigError when secret is empty', async () => {
    const env = makeEnv({ secret: '' })
    const { challengeId } = await issueChallenge(makeEnv())
    await expect(verifyChallenge(challengeId, VALID_PROMPT, env)).rejects.toThrow(
      ChallengeConfigError,
    )
  })

  it('returns token_invalid for a HMAC-valid payload with missing issuedAt (NaN bypass guard)', async () => {
    const corruptPayload = { entryId: FAKE_ENTRY_ID, nonce: 'test' } // no issuedAt
    const corruptJson = JSON.stringify(corruptPayload)
    const b64 = btoa(corruptJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64))
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const env = makeEnv()
    const result = await verifyChallenge(`${b64}.${sig}`, VALID_PROMPT, env)
    expect(result).toEqual({ kind: 'token_invalid' })
  })

  it('returns token_invalid for a HMAC-valid payload with missing entryId', async () => {
    const corruptPayload = { nonce: 'test', issuedAt: Date.now() }
    const corruptJson = JSON.stringify(corruptPayload)
    const b64 = btoa(corruptJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64))
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const env = makeEnv()
    const result = await verifyChallenge(`${b64}.${sig}`, VALID_PROMPT, env)
    expect(result).toEqual({ kind: 'token_invalid' })
  })

  it('returns token_invalid for a HMAC-valid payload with empty entryId', async () => {
    const corruptPayload = { entryId: '   ', nonce: 'test', issuedAt: Date.now() }
    const corruptJson = JSON.stringify(corruptPayload)
    const b64 = btoa(corruptJson).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64))
    const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    const env = makeEnv()
    const result = await verifyChallenge(`${b64}.${sig}`, VALID_PROMPT, env)
    expect(result).toEqual({ kind: 'token_invalid' })
  })

  it('DAILY_QUOTA constant is 20', () => {
    expect(DAILY_QUOTA).toBe(20)
  })

  // ─── internal bypass ──────────────────────────────────────────────────────

  it('returns verified{entryId:internal} when internalToken matches SLOPSPOT_INTERNAL_SEED_TOKEN', async () => {
    const env = { ...makeEnv(), SLOPSPOT_INTERNAL_SEED_TOKEN: 'secret-seed-token' } as unknown as Env
    const result = await verifyChallenge('any-challenge-id', 'any prompt', env, Date.now(), 'secret-seed-token')
    expect(result).toEqual({ kind: 'verified', entryId: 'internal' })
  })

  it('bypasses all gate checks — does not call DB.batch (no quota consumed)', async () => {
    const db = makeMockDB()
    const env = {
      ...makeEnv(),
      SLOPSPOT_INTERNAL_SEED_TOKEN: 'secret-seed-token',
      DB: db,
    } as unknown as Env
    await verifyChallenge('any', 'any prompt', env, Date.now(), 'secret-seed-token')
    expect(db.batch).not.toHaveBeenCalled()
  })

  it('falls through to normal pipeline when internalToken does not match', async () => {
    const env = { ...makeEnv(), SLOPSPOT_INTERNAL_SEED_TOKEN: 'secret-seed-token' } as unknown as Env
    const { challengeId } = await issueChallenge(env)
    const result = await verifyChallenge(challengeId, VALID_PROMPT, env, Date.now(), 'wrong-token')
    expect(result).toEqual({ kind: 'verified', entryId: FAKE_ENTRY_ID })
  })

  it('falls through to normal pipeline when SLOPSPOT_INTERNAL_SEED_TOKEN is not set', async () => {
    const { challengeId } = await issueChallenge(makeEnv())
    const result = await verifyChallenge(challengeId, VALID_PROMPT, makeEnv(), Date.now(), 'any-token')
    expect(result).toEqual({ kind: 'verified', entryId: FAKE_ENTRY_ID })
  })
})
