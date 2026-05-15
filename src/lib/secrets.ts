import { execFileSync } from 'node:child_process'

// [LAW:single-enforcer] All secret reads in this app go through getSecret().
// No provider plugin, route handler, or anywhere else should spawn `security`
// or read keychain entries directly. The keychain is the source of truth on
// this machine; everything else asks for a named secret by slug.

const cache = new Map<string, string>()

export function getSecret(slug: string): string {
  if (typeof window !== 'undefined') {
    // [LAW:no-shared-mutable-globals] exception: belt-and-suspenders guard.
    // child_process can't bundle into a client build, but if someone ever
    // does manage to import this from a client component, fail loudly here
    // rather than silently expose an attack surface.
    throw new Error('getSecret() is server-only')
  }
  const cached = cache.get(slug)
  if (cached !== undefined) return cached

  let value: string
  try {
    value = execFileSync(
      'security',
      ['find-generic-password', '-s', slug, '-a', process.env.USER ?? '', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim()
  } catch {
    throw new Error(
      `Secret not found in keychain: ${slug}. Store it with:\n` +
      `  security add-generic-password -s "${slug}" -a "$USER" -w "<value>" -U`,
    )
  }

  if (!value) throw new Error(`Keychain returned empty value for: ${slug}`)
  cache.set(slug, value)
  return value
}
