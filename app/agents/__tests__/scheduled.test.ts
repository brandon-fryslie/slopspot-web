// [LAW:verifiable-goals][LAW:no-ambient-temporal-coupling] The 3am path under test on every push.
// This fires the REAL workers/app.ts `scheduled` export through `createScheduledController` against
// real D1/R2 in a workerd isolate — the actual prod dispatch (cron routing → the CEREMONIES registry
// loop → per-ceremony catch-isolation → the D1 metric flush), not a re-implementation. The ONLY things
// faked are the two genuine externalities, at their declared seams, exactly as prod's own substitutes do:
//   - the LLM author — SLOPSPOT_ENV='dev' selects haiku.ts's deterministic fake (the same env gate
//     realProviders() uses). [LAW:effects-at-boundaries]
//   - the image upstream — the seeded generators are re-mediumed to their `-mock` providers, which run
//     the exact createPost→R2→D1 path with only the upstream HTTP faked. Real providers would each hang
//     ~15s on the isolate's absent egress (a 32s pass); the mock is instant AND deterministic.
//
// What this catches that the per-ceremony tests (rite/midwife/portrait/…) cannot: the DISPATCH WIRING —
// that the 0 3 arm loops the registry, that a thrown ceremony does not abort its siblings, that a
// re-fire records nothing new, and that emitted metrics reach the durable D1 store the /metrics scrape
// reads (the slopspot-observability-gtz path, exercised end-to-end here).
//
// Outcomes are emergent, not asserted-into-existence: on a fresh migration-seeded corpus grace is
// `barren`, first-poet is `no-poet`, and the Rite is an `unmoved` day. Birth `born`s a citizen: with
// the wall full (roll-call-f7n) the portrait pass writes 13 self-portraits first, and that richer
// taste-landscape gives the midwife a gap to fill — the dispatch ORDER producing a real outcome. We
// assert the observable outcome, never the internal that produced it. [LAW:behavior-not-structure]

import { env, createScheduledController, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listAllPersonas, updatePersonaConfig } from '~/agents/persona'
import { readDurableCounters } from '~/db/metric-counters'
import { resetCountersForTesting, type MetricEntry } from '~/observability/metrics'
import { db } from '~/db/client'
import { posts, generations, personas, utterances } from '~/db/schema'
import { eq } from 'drizzle-orm'
import { AgentId } from '~/lib/domain'

// [LAW:effects-at-boundaries] A hoisted switch lets ONE test force a single ceremony to throw while
// every other test runs the real pass. The registry (~/agents/ceremonies) captures runPortraitPass by
// reference at import, so wrapping the module export here is what makes the registry's `portrait.run`
// the throwing version — exercising workers/app.ts's per-ceremony catch on the real dispatch path.
const { portraitCtl } = vi.hoisted(() => ({ portraitCtl: { mode: 'normal' as 'normal' | 'throw' | 'skip' } }))
vi.mock('~/agents/portrait', async (importOriginal) => {
  const orig = await importOriginal<typeof import('~/agents/portrait')>()
  return {
    ...orig,
    runPortraitPass: (e: Env, ms: number) => {
      switch (portraitCtl.mode) {
        case 'throw':
          return Promise.reject(new Error('forced portrait failure (catch-isolation test)'))
        case 'skip':
          return Promise.resolve() // a true no-op: writes no art, leaving the corpus empty for birth
        case 'normal':
          return orig.runPortraitPass(e, ms)
      }
    },
  }
})

// Imported AFTER the hoisted vi.mock (vitest hoists vi.mock above all imports) so the registry inside
// workers/app.ts binds the wrapped portrait pass.
import worker from '../../../workers/app'

// 2026-01-15 03:00 UTC is a Thursday → the Rite's lens for the day is `martyr` (riteForDay weekday map).
const SCHEDULED_MS = Date.UTC(2026, 0, 15, 3, 0)
const CEREMONY_CRON = '0 3 * * *'

// The seeded generators author in real providers (fal-flux / replicate-sdxl / replicate-ideogram). Point
// each at its `-mock` sibling so the self-portrait renders through the real persistence path without the
// absent-egress hang. Test data only — no production code path is forked.
const MOCK_OF: Record<string, string> = {
  'fal-flux': 'fal-flux-mock',
  'replicate-sdxl': 'replicate-sdxl-mock',
  'replicate-ideogram': 'replicate-ideogram-mock',
}

async function remediumToMock(devEnv: Env): Promise<void> {
  for (const p of await listAllPersonas(devEnv)) {
    const medium = typeof p.config.medium === 'string' ? p.config.medium : null
    const mock = medium ? MOCK_OF[medium] : undefined
    if (mock) await updatePersonaConfig(devEnv, AgentId(p.agentId), { ...p.config, medium: mock })
  }
}

async function fireCron(devEnv: Env, ms: number = SCHEDULED_MS): Promise<void> {
  const ctx = createExecutionContext()
  const controller = createScheduledController({ cron: CEREMONY_CRON, scheduledTime: ms })
  await worker.scheduled!(controller, devEnv, ctx)
  await waitOnExecutionContext(ctx)
}

const named = (counters: readonly MetricEntry[], name: string): MetricEntry[] =>
  counters.filter((c) => c.name === name)

const rowCounts = async (devEnv: Env) => ({
  gens: (await db(devEnv).select().from(generations)).length,
  posts: (await db(devEnv).select().from(posts)).length,
  personas: (await db(devEnv).select().from(personas)).length,
  utterances: (await db(devEnv).select().from(utterances)).length,
})

describe('scheduled - the real 0 3 cron dispatch, in-isolate', () => {
  beforeEach(() => {
    resetCountersForTesting()
    portraitCtl.mode = 'normal'
  })
  afterEach(() => {
    portraitCtl.mode = 'normal'
  })

  it('routes the 0 3 cron to the registry and runs every ceremony, flushing each outcome to durable D1', async () => {
    const devEnv = { ...env, SLOPSPOT_ENV: 'dev' } as Env
    await remediumToMock(devEnv)

    await fireCron(devEnv)

    // The metric flush is part of the dispatch under test: after the handler returns, the counters live
    // in the durable metric_counters table (NOT the drained in-process buffer) — the same view /metrics
    // reads. Reading them here proves the gtz flush fired at the scheduled boundary. [LAW:no-silent-failure]
    const counters = await readDurableCounters(devEnv)

    // Every ceremony in the registry ran (each emits at least its own outcome metric).
    // The wall is full (roll-call-f7n): 13 medium-having faces render — the 3 makers plus
    // the 10 critics + scavengers migration 0046 gave a portrait medium. The Gremlin
    // ('refused') and the Proprietor ('declined') stay off the wall by their data.
    expect(named(counters, 'slopspot.portrait.render').length).toBe(13)
    expect(named(counters, 'slopspot.rite.outcome')).toHaveLength(1)
    expect(named(counters, 'slopspot.birth.outcome')).toHaveLength(1)
    expect(named(counters, 'slopspot.grace.outcome')).toHaveLength(1)
    expect(named(counters, 'slopspot.firstpoet.decree')).toHaveLength(1)
    expect(named(counters, 'slopspot.trait.spread')).toHaveLength(8) // 2 cohorts × 4 axes

    // The deterministic empty-corpus outcomes — the observable verdict each ceremony reaches with no
    // posts/votes/engagement yet. (Birth's skip REASON is left unpinned: it is an artifact of the fake
    // author's gap math, an internal, not the dispatch contract. [LAW:behavior-not-structure])
    expect(named(counters, 'slopspot.portrait.render').every((c) => c.labels.outcome === 'rendered')).toBe(true)
    expect(named(counters, 'slopspot.rite.outcome')[0]!.labels).toMatchObject({ lens: 'martyr', outcome: 'unmoved' })
    expect(named(counters, 'slopspot.grace.outcome')[0]!.labels.outcome).toBe('barren')
    expect(named(counters, 'slopspot.firstpoet.decree')[0]!.labels.outcome).toBe('no-poet')
  })

  it('writes content rows through the real persistence path (portrait renders -> posts + succeeded generations)', async () => {
    const devEnv = { ...env, SLOPSPOT_ENV: 'dev' } as Env
    await remediumToMock(devEnv)

    await fireCron(devEnv)

    // The three self-portraits committed real rows via createPost→R2→D1 — the cron actually persisted
    // content, not just emitted metrics. Every generation the cron wrote succeeded (mock upstream).
    const genRows = await db(devEnv).select().from(generations)
    const postRows = await db(devEnv).select().from(posts)
    expect(genRows.length).toBeGreaterThanOrEqual(3)
    expect(genRows.every((g) => g.status === 'succeeded')).toBe(true)
    expect(postRows.length).toBeGreaterThanOrEqual(3)
    expect(postRows.every((p) => p.contentKind === 'generation')).toBe(true)
  })

  it('is idempotent: re-firing the same scheduledTime records nothing new', async () => {
    const devEnv = { ...env, SLOPSPOT_ENV: 'dev' } as Env
    await remediumToMock(devEnv)

    // [LAW:no-ambient-temporal-coupling] The invariant under test is that the DAY-KEYED ceremonies do
    // not double-write on a same-scheduledTime re-fire (a retry): birth's per-day citizen id, the Rite's
    // crowning, the decree, the announce. The portrait pass is NOT day-keyed — it is DRIFT-based, and a
    // citizen BORN in fire 1 (a generator with a medium, no face yet) is a legitimately-new portrait
    // target on fire 2, exactly as it would be on the next day's pass. That catch-up is correct, not a
    // double-write — its own re-fire semantics (the drift guard) live in portrait.test.ts. We skip the
    // portrait pass here so the day-key idempotency is tested in isolation, not entangled with the
    // birth→portrait order. (Before the wall filled, birth happened to SKIP, hiding this entirely.)
    portraitCtl.mode = 'skip'

    await fireCron(devEnv)
    const after1 = await rowCounts(devEnv)

    await fireCron(devEnv) // same scheduledTime
    const after2 = await rowCounts(devEnv)

    // Birth sees the settled day, the Rite/grace/first-poet their settled keys — so the re-fire adds
    // zero rows in every table the cron writes. [LAW:no-ambient-temporal-coupling]
    expect(after2).toEqual(after1)
  })

  it('persists ceremony-specific rows: the cron births a citizen (personas + birth utterance)', async () => {
    const devEnv = { ...env, SLOPSPOT_ENV: 'dev' } as Env
    // With portrait writing no art first, the midwife stays in roster-regime and the fake author births a
    // distinct citizen — so this drives the dispatch through the persona + utterance write path that an
    // empty corpus otherwise leaves dormant. (The image upstream stays faked; only the corpus differs.)
    portraitCtl.mode = 'skip'

    await fireCron(devEnv)

    // The Birth Engine wrote the day's citizen through the real createPersona path.
    const born = await db(devEnv).select().from(personas).where(eq(personas.agentId, 'agent:born-2026-01-15'))
    expect(born).toHaveLength(1)
    expect(born[0]!.role).toBe('generator')

    // The Proprietor's welcome was recorded as a 'birth' utterance through the one Voice mechanism.
    const birthUtterances = await db(devEnv).select().from(utterances).where(eq(utterances.occasion, 'birth'))
    expect(birthUtterances).toHaveLength(1)
  })

  it('catch-isolation: one ceremony throwing does not abort the others', async () => {
    const devEnv = { ...env, SLOPSPOT_ENV: 'dev' } as Env
    await remediumToMock(devEnv)
    portraitCtl.mode = 'throw' // the first ceremony in the registry rejects outright

    await fireCron(devEnv)

    const counters = await readDurableCounters(devEnv)
    // Portrait threw before emitting — its metric is absent...
    expect(named(counters, 'slopspot.portrait.render')).toHaveLength(0)
    // ...yet every ceremony AFTER it in the ordered registry still ran (the independent-jobs invariant:
    // workers/app.ts wraps each ceremony in its own catch).
    expect(named(counters, 'slopspot.rite.outcome')).toHaveLength(1)
    expect(named(counters, 'slopspot.birth.outcome')).toHaveLength(1)
    expect(named(counters, 'slopspot.grace.outcome')).toHaveLength(1)
    expect(named(counters, 'slopspot.firstpoet.decree')).toHaveLength(1)
    expect(named(counters, 'slopspot.trait.spread')).toHaveLength(8)
  })
})
