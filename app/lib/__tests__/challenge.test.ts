import { describe, it, expect } from 'vitest'
import { issueChallenge, verifyChallenge, CHALLENGE_TTL_MS } from '~/lib/challenge'

const SECRET = 'test-secret-for-unit-tests'

describe('issueChallenge', () => {
  it('returns a challengeId, text, templateId, and expiresAt', async () => {
    const result = await issueChallenge(SECRET)
    expect(result.challengeId).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(result.text).toBeTruthy()
    expect(result.templateId).toBe('scg-7.4.1')
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now())
  })

  it('throws when secret is empty', async () => {
    await expect(issueChallenge('')).rejects.toThrow('SLOPSPOT_CHALLENGE_SECRET is not configured')
  })
})

describe('verifyChallenge', () => {
  it('returns ok:true for a valid token with correct ack', async () => {
    const { challengeId } = await issueChallenge(SECRET)
    const result = await verifyChallenge(challengeId, 'residue I have read the terms', SECRET)
    expect(result).toEqual({ ok: true, templateId: 'scg-7.4.1' })
  })

  it('returns wrong_ack for an ack that does not start with the expected prefix', async () => {
    const { challengeId } = await issueChallenge(SECRET)
    const result = await verifyChallenge(challengeId, 'something else entirely', SECRET)
    expect(result).toEqual({ ok: false, reason: 'wrong_ack' })
  })

  it('is case-insensitive for the ack prefix', async () => {
    const { challengeId } = await issueChallenge(SECRET)
    const result = await verifyChallenge(challengeId, 'RESIDUE acknowledged', SECRET)
    expect(result).toEqual({ ok: true, templateId: 'scg-7.4.1' })
  })

  it('returns invalid_signature for a tampered token', async () => {
    const { challengeId } = await issueChallenge(SECRET)
    const tampered = challengeId.slice(0, -3) + 'abc'
    const result = await verifyChallenge(tampered, 'residue ok', SECRET)
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('returns invalid_signature when verified with the wrong secret', async () => {
    const { challengeId } = await issueChallenge(SECRET)
    const result = await verifyChallenge(challengeId, 'residue ok', 'wrong-secret')
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('returns malformed for a token with no dot separator', async () => {
    const result = await verifyChallenge('nodothere', 'residue ok', SECRET)
    expect(result).toEqual({ ok: false, reason: 'malformed' })
  })

  it('returns invalid_signature for a token with garbage payload (HMAC check fires first)', async () => {
    const result = await verifyChallenge('!!!.invalidsig', 'residue ok', SECRET)
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' })
  })

  it('returns expired when the token is past its TTL', async () => {
    const pastTs = Date.now() - CHALLENGE_TTL_MS - 1
    const { challengeId } = await issueChallenge(SECRET, pastTs)
    const result = await verifyChallenge(challengeId, 'residue ok', SECRET)
    expect(result).toEqual({ ok: false, reason: 'expired' })
  })

  it('handles base64url payloads requiring padding (all padding lengths)', async () => {
    // Issue many tokens until we see all payload lengths mod 4
    const seen = new Set<number>()
    for (let i = 0; i < 40 && seen.size < 3; i++) {
      const { challengeId } = await issueChallenge(SECRET)
      const payloadB64 = challengeId.slice(0, challengeId.lastIndexOf('.'))
      seen.add(payloadB64.length % 4)
      const result = await verifyChallenge(challengeId, 'residue ok', SECRET)
      expect(result.ok).toBe(true)
    }
  })

  it('throws when secret is empty', async () => {
    const { challengeId } = await issueChallenge(SECRET)
    await expect(verifyChallenge(challengeId, 'residue ok', '')).rejects.toThrow(
      'SLOPSPOT_CHALLENGE_SECRET is not configured',
    )
  })
})
