// [LAW:single-enforcer] The one definition of admin auth logic. Every admin
// loader and action calls this; the check is not re-implemented per route.
// The key arrives via ?key= so every form action URL includes it — both GET
// navigations and POST submissions hit the same check.

import { data } from 'react-router'

export function requireAdmin(request: Request, env: Env): string {
  const url = new URL(request.url)
  const key = url.searchParams.get('key') ?? ''
  if (!env.ADMIN_KEY || key !== env.ADMIN_KEY) {
    throw data('Unauthorized', { status: 401 })
  }
  return key
}
