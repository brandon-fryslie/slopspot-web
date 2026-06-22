// [LAW:types-are-the-program] A smoke run is parameterized by its TARGET — a
// value carrying where to point and what it's allowed to do. The two target
// constructors below ARE the cost-safety boundary: a suite that only reads (or
// self-cleans) calls readTarget(); a suite that MUTATES calls writeTarget(),
// which demands a dev-env URL + the internal token. The "is this safe to mutate?"
// question is answered once, by which constructor a suite invokes — not by a
// branch scattered through every test. [LAW:dataflow-not-control-flow]

export type ReadTarget = { readonly baseUrl: string }
export type WriteTarget = { readonly baseUrl: string; readonly internalToken: string }
export type CeremonyTarget = { readonly baseUrl: string; readonly adminKey: string }

// [LAW:no-silent-fallbacks] An unset target is a misconfiguration, not a reason
// to quietly pass. Every accessor throws loudly with the env var name + a hint,
// so a smoke run against nothing fails visibly instead of greenwashing.
function requireEnv(name: string, hint: string): string {
  const value = process.env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(`[smoke] ${name} is not set — ${hint}`)
  }
  return value.trim()
}

function requireBaseUrl(name: string, hint: string): string {
  const raw = requireEnv(name, hint)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`[smoke] ${name}=${raw} is not a valid URL — ${hint}`)
  }
  // Normalize: drop a trailing slash so callers build `${baseUrl}/path` cleanly.
  return url.origin + url.pathname.replace(/\/$/, '')
}

// The read/liveness target. Prod-safe by construction — the suite that uses it
// only GETs and casts a self-retracting vote (zero residue). Defaults to the
// live site so the scheduled prod probe needs no extra wiring.
export function readTarget(): ReadTarget {
  const baseUrl = process.env.SMOKE_BASE_URL?.trim()
    ? requireBaseUrl('SMOKE_BASE_URL', 'the read/liveness base URL, e.g. https://slopspot.ai')
    : 'https://slopspot.ai'
  return { baseUrl }
}

// [LAW:no-silent-fallbacks] The MUTATING target. Tier-2 smoke tests write real
// posts (generate/breed/found) — they MUST hit a dev-env server (SLOPSPOT_ENV=dev,
// disposable D1/R2, mock providers allowed), NEVER prod (breed's realProviders
// guard rejects mock media in prod, and generate/found would pollute the live
// feed with no delete path). Provisioning that staging target is slopspot-breeding-3xe.5;
// until it lands SMOKE_WRITE_BASE_URL is unset and this throws — the Tier-2 suite
// fails LOUD rather than silently skipping. It lights up the moment 3xe.5 sets the var.
export function writeTarget(): WriteTarget {
  const baseUrl = requireBaseUrl(
    'SMOKE_WRITE_BASE_URL',
    'the DEV/STAGING base URL for mutating smoke tests — blocked on slopspot-breeding-3xe.5 (staging deploy). NEVER point this at prod: it writes real posts.',
  )
  const internalToken = requireEnv(
    'SLOPSPOT_INTERNAL_SEED_TOKEN',
    'the internal token (matches the target\'s SLOPSPOT_INTERNAL_SEED_TOKEN) that bypasses the challenge bank so generation can drive the mock provider deterministically',
  )
  return { baseUrl, internalToken }
}

// [LAW:one-source-of-truth] The CEREMONY-actuator target. It hits the SAME dev/staging
// worker as writeTarget (the actuator route 404s outside SLOPSPOT_ENV=dev), so it reuses
// SMOKE_WRITE_BASE_URL rather than minting a second base-URL var that would have to agree
// with it. What differs is the CREDENTIAL: the actuator (/admin/ceremony/:name) authenticates
// via requireAdmin's ?key=<ADMIN_KEY>, not the challenge-bypass internal token — so this
// constructor demands ADMIN_KEY (the same name as the worker secret it must match) and a 401
// is the loud failure when they diverge. [LAW:no-silent-fallbacks] both vars are required;
// an unset target throws in beforeAll rather than greenwashing against nothing.
export function ceremonyTarget(): CeremonyTarget {
  const baseUrl = requireBaseUrl(
    'SMOKE_WRITE_BASE_URL',
    'the DEV/STAGING base URL for the ceremony actuator. NEVER point it at prod: the actuator 404s there by design, and firing real ceremonies writes rows + (for portrait) spends real provider cost.',
  )
  const adminKey = requireEnv(
    'ADMIN_KEY',
    "the staging worker's ADMIN_KEY — the actuator gates on ?key=<ADMIN_KEY> (requireAdmin); a mismatch is 401, not a pass",
  )
  return { baseUrl, adminKey }
}
