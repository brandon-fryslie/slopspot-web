// [LAW:single-enforcer] The one definition of admin auth logic. Every admin
// loader and action calls this; the check is not re-implemented per route.
// The key arrives via ?key= so every form action URL includes it.
//
// Security posture of ?key= (v1, pre-auth-epic):
//   ACCEPTED: key appears in browser history, Cloudflare access logs, and
//   the action URL embedded in the rendered HTML. Tolerable for an internal
//   admin tool that sits behind Cloudflare's HTTPS edge — the alternative
//   (signed cookie) requires a session flow we're deferring to the auth epic.
//   MITIGATED: HMAC-based constant-time comparison prevents timing attacks;
//   sha-256 digest equality is safe even when input lengths differ.
//
// When the auth epic lands, replace this with cookie-session auth and remove
// the ?key= propagation from admin route action URLs.

import { data } from 'react-router'

// Constant-time comparison via HMAC under an ephemeral key.
// Prevents timing attacks where an attacker measures comparison time to learn
// prefix bits of the key. Generates a fresh ephemeral key each call so the
// HMAC values are unguessable and comparison is data-independent.
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const [sigA, sigB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, enc.encode(a)),
    crypto.subtle.sign('HMAC', key, enc.encode(b)),
  ])
  const aArr = new Uint8Array(sigA)
  const bArr = new Uint8Array(sigB)
  let diff = 0
  for (let i = 0; i < aArr.length; i++) {
    diff |= aArr[i] ^ bArr[i]
  }
  return diff === 0
}

export async function requireAdmin(request: Request, env: Env): Promise<string> {
  const url = new URL(request.url)
  const key = url.searchParams.get('key') ?? ''
  if (!env.ADMIN_KEY || !(await constantTimeEqual(key, env.ADMIN_KEY))) {
    throw data('Unauthorized', { status: 401 })
  }
  return key
}
