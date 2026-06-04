// [LAW:single-enforcer] One place the smoke suites speak HTTP. Keeps the cookie
// threading (needed for the self-retracting vote probe — the retract must reuse
// the voter cookie minted by the upvote, or it cancels nothing) in a single
// helper rather than re-derived per test.

// The Set-Cookie response header carries `name=value; Path=/; ...attrs`. To send
// it back as a request Cookie header we want only the `name=value` pair(s).
// undici exposes getSetCookie() for the multi-value case; fall back to the
// single combined header otherwise.
export function cookieJarFromResponse(res: Response): string | null {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] }
  const raw = typeof headers.getSetCookie === 'function' ? headers.getSetCookie() : []
  const list = raw.length > 0 ? raw : (() => {
    const single = res.headers.get('set-cookie')
    return single === null ? [] : [single]
  })()
  if (list.length === 0) return null
  return list.map((c) => c.split(';', 1)[0]!.trim()).join('; ')
}

export type JsonInit = {
  method?: string
  cookie?: string | null
  internalToken?: string
  body?: unknown
}

// A JSON request that returns the raw Response (caller reads status + body +
// headers — the HTTP contract is what these tests assert). No Origin header is
// sent: isSameOrigin treats an absent Origin as same-origin, so cookie-auth
// POSTs (vote/found/breed) pass the CSRF gate exactly as a same-site fetch would.
export async function jsonRequest(url: string, init: JsonInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.cookie) headers['cookie'] = init.cookie
  if (init.internalToken) headers['X-Internal-Token'] = init.internalToken
  return fetch(url, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}
