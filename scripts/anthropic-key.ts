// [LAW:single-enforcer][LAW:one-source-of-truth] The ONE Anthropic-key resolver for the tsx scripts that
// call live Haiku (the earnestness soul-test, the FORK C re-voice eval gate). Env first, then .dev.vars
// resolved PORTABLY — relative to this script and to the git common dir, never a hardcoded machine path
// (the pre-deploy eval gate runs this; an absolute path would break it on any other checkout/machine). A
// script that calls a paid API must fail LOUD when there is no key, never silently no-op. [LAW:no-silent-fallbacks]

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = 'SLOPSPOT_ANTHROPIC_API_KEY'

// The .dev.vars locations to probe, derived portably — never absolute. In order: the current working
// directory; this checkout's repo root (this script lives in <root>/scripts/); and, for a linked git
// WORKTREE (whose own .dev.vars carries an empty key), the MAIN worktree's root via the git common dir.
function devVarsCandidates(): string[] {
  const here = dirname(fileURLToPath(import.meta.url)) // <repo>/scripts
  const candidates = [join(process.cwd(), '.dev.vars'), join(here, '..', '.dev.vars')]
  try {
    // --git-common-dir points at the SHARED .git of the main worktree; its parent is that worktree's root.
    const commonDir = execFileSync('git', ['-C', here, 'rev-parse', '--absolute-git-dir', '--git-common-dir'], {
      encoding: 'utf8',
    })
      .trim()
      .split('\n')
      .pop()
    if (commonDir) candidates.push(join(dirname(commonDir), '.dev.vars'))
  } catch {
    // not a git checkout (or git absent) — the cwd/repo-root candidates still apply
  }
  return candidates
}

export function resolveAnthropicKey(): string {
  const fromEnv = process.env[KEY]
  if (fromEnv && fromEnv.length > 0) return fromEnv
  for (const path of devVarsCandidates()) {
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
  throw new Error(`No ${KEY} in env or any .dev.vars (probed: cwd, repo root, git main worktree)`)
}
