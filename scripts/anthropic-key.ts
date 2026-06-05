// [LAW:single-enforcer][LAW:one-source-of-truth] The ONE Anthropic-key resolver for the tsx scripts that
// call live Haiku (the earnestness soul-test, the FORK C re-voice eval gate). Env first, then the repo's
// .dev.vars — a worktree's .dev.vars carries an empty key, so the main repo's is the fallback. A script
// that calls a paid API must fail LOUD when there is no key, never silently no-op. [LAW:no-silent-fallbacks]

import { readFileSync } from 'node:fs'

const KEY = 'SLOPSPOT_ANTHROPIC_API_KEY'

export function resolveAnthropicKey(): string {
  const fromEnv = process.env[KEY]
  if (fromEnv && fromEnv.length > 0) return fromEnv
  for (const path of ['.dev.vars', '../../.dev.vars', '/Users/bmf/code/slopspot-web/.dev.vars']) {
    try {
      const line = readFileSync(path, 'utf8')
        .split('\n')
        .find((l) => l.startsWith(`${KEY}=`))
      const val = line?.slice(`${KEY}=`.length).trim().replace(/^["']|["']$/g, '')
      if (val && val.length > 0) return val
    } catch {
      // try the next path
    }
  }
  throw new Error(`No ${KEY} in env or any .dev.vars`)
}
