// [LAW:single-enforcer] The only module that queries Cloudflare D1 via the
// REST API. All D1 reads in this service go through d1Query — no other module
// calls the Cloudflare API directly.

export type D1Config = {
  apiToken: string
  accountId: string
  databaseId: string
}

// [LAW:types-are-the-program] The REST API wraps rows in result[0].results.
// This type is the exact shape the API returns; callers cast to their domain
// type via the generic T parameter.
type D1Response<T> = {
  result: Array<{ results: T[] }>
  success: boolean
  errors: Array<{ message: string }>
}

export async function d1Query<T>(
  cfg: D1Config,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const url = `https://api.cloudflare.com/client/v4/accounts/${cfg.accountId}/d1/database/${cfg.databaseId}/query`
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.apiToken}`,
    },
    body: JSON.stringify({ sql, params }),
  })
  if (!resp.ok) {
    const body = await resp.text().catch(() => '(unreadable)')
    throw new Error(
      `D1 query failed: ${resp.status} ${resp.statusText} — ${body.slice(0, 300)}`,
    )
  }
  const json = (await resp.json()) as D1Response<T>
  if (!json.success) {
    const msg = json.errors.map((e) => e.message).join('; ')
    throw new Error(`D1 query error: ${msg}`)
  }
  return json.result[0]?.results ?? []
}
