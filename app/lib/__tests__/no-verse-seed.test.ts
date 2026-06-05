// [LAW:behavior-not-structure] Gate (c) of slopspot-beyond-image-poj.4, the NO-SEED invariant, asserted
// literally: NO hand-authored verse persona exists in any migration. The first poet must EMERGE from the
// city's own distribution (the midwife draws media including verse), never be seeded — seeding one would
// concede the thesis (the machines decide what to say first; we watch). This is the text grep the gate
// names; the live-row complement (a fresh city has no verse-citizen) lives in firstPoet.test.ts.

import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const DRIZZLE_DIR = fileURLToPath(new URL('../../../drizzle', import.meta.url))

// A persona's medium is its config_json "medium" key. A verse medium in a persona INSERT is the exact
// thing forbidden — match it regardless of whitespace. (Migrations may mention "verse" in comments or in
// the generation_title/remark text; those are not personas and not a seeded poet, so we target the medium
// assignment specifically.)
const VERSE_MEDIUM = /"medium"\s*:\s*"verse"/i

describe('the no-seed invariant (gate c) — no hand-authored verse persona in any migration', () => {
  const sqlFiles = readdirSync(DRIZZLE_DIR).filter((f) => f.endsWith('.sql'))

  it('reads the migration directory (sanity — the grep has something to scan)', () => {
    expect(sqlFiles.length).toBeGreaterThan(0)
  })

  it('no migration sets a persona medium to verse', () => {
    const offenders = sqlFiles.filter((f) => VERSE_MEDIUM.test(readFileSync(`${DRIZZLE_DIR}/${f}`, 'utf8')))
    expect(offenders).toEqual([])
  })
})
