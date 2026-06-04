// [LAW:single-enforcer] One place the smoke suites speak HTTP — the JSON request
// shape (status + body + headers are what these tests assert) lives here once.

export type JsonInit = {
  method?: string
  internalToken?: string
  body?: unknown
}

// A JSON request that returns the raw Response. No Origin header is sent:
// isSameOrigin treats an absent Origin as same-origin, so cookie-auth POSTs
// (vote/found/breed) pass the CSRF gate exactly as a same-site fetch would.
// Mutating probes carry their identity in the body (a self-reported agentId),
// not in an emergent cookie — so there is no cookie state to thread.
export async function jsonRequest(url: string, init: JsonInit = {}): Promise<Response> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (init.internalToken) headers['X-Internal-Token'] = init.internalToken
  return fetch(url, {
    method: init.method ?? 'GET',
    headers,
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  })
}
