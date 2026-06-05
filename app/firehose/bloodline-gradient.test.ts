import { describe, expect, it } from 'vitest'
import { GenomeId, PostId } from '~/lib/domain'
import type { FitnessCandidate } from '~/db/genepool'
import { descendants, ancestralFounders } from '~/lib/genealogy'
import type { LineageDag } from '~/db/genome-dag'
import { FOUNDER_RATE, selectReproduction } from '~/firehose/select'
import { recencyWeight } from '~/lib/recency'
import { seedHash } from '~/lib/hash'

// [LAW:behavior-not-structure] The behavioral acceptance for the bloodline-fitness gradient with
// recency-to-parity (CD-ruled): (1) the monoculture GUARD — a runaway dynasty can NOT suppress
// novelty (FOUNDER_RATE is fitness-independent); (2) the cross-niche guard is untouched (niche-pick
// weights are citizen activity, never bloodline fitness); (3) CONTESTABILITY — an established
// house's reign DECAYS to an earned peer once the niche shifts its blessings, within bounded fires.
// Pure simulations of the real fold (recency-decayed bloodlineFitness + selectReproduction), seeded.

// A mutable lineage sim with per-vote timestamps (in "fires"), so fitness is recency-decayed exactly
// as genepool decays real votes. recencyWeight is unit-agnostic (age/half-life ratio), so fires work.
const HALF_LIFE_FIRES = 25

class Sim {
  readonly parents = new Map<GenomeId, GenomeId[]>()
  readonly children = new Map<GenomeId, GenomeId[]>()
  readonly voteValue = new Map<GenomeId, number>()
  readonly voteFire = new Map<GenomeId, number>()
  readonly ids: GenomeId[] = []
  private seq = 0

  private push(m: Map<GenomeId, GenomeId[]>, k: GenomeId, v: GenomeId) {
    const list = m.get(k)
    if (list) list.push(v)
    else m.set(k, [v])
  }
  private link(child: GenomeId, parent: GenomeId) {
    this.push(this.parents, child, parent)
    this.push(this.children, parent, child)
  }
  founder(id: string): GenomeId {
    const g = GenomeId(id)
    this.ids.push(g)
    return g
  }
  child(parents: GenomeId[]): GenomeId {
    const c = GenomeId(`x${this.seq++}`)
    this.ids.push(c)
    for (const p of parents) this.link(c, p)
    return c
  }
  bless(id: GenomeId, fire: number) {
    this.voteValue.set(id, 1)
    this.voteFire.set(id, fire)
  }
  private dag(): LineageDag {
    return { nodes: new Map(), parents: this.parents, children: this.children }
  }
  // recency-decayed bloodline fitness: each blessing's weight decays by its age in fires
  fit(id: GenomeId, now: number): number {
    const w = (g: GenomeId) => (this.voteValue.get(g) ?? 0) * recencyWeight(now - (this.voteFire.get(g) ?? now), HALF_LIFE_FIRES)
    let s = w(id)
    for (const d of descendants(this.dag(), id)) s += w(d)
    return s
  }
  candidates(now: number): FitnessCandidate[] {
    return this.ids.map((id) => ({ ref: PostId(id), fitness: this.fit(id, now) }))
  }
  descendsFrom(id: GenomeId, founder: GenomeId): boolean {
    return ancestralFounders(this.dag(), id).includes(founder)
  }
}

describe('bloodline gradient — monoculture guard + cross-niche invariance', () => {
  it('a runaway dynasty cannot suppress novelty: FOUNDER_RATE holds regardless of fitness skew', () => {
    // One genome at fitness 1000, nine at fitness 1 — a maximally dominant line. The founder draw
    // must STILL fire at ~FOUNDER_RATE: novelty injection is fitness-INDEPENDENT, so no dynasty can
    // freeze the pool. TEETH: if breed-weight scaled with fitness mass, this would collapse.
    const skewed: FitnessCandidate[] = [
      { ref: PostId('whale'), fitness: 1000 },
      ...Array.from({ length: 9 }, (_, i) => ({ ref: PostId(`p${i}`), fitness: 1 })),
    ]
    let founders = 0
    const N = 4000
    for (let s = 0; s < N; s++) if (selectReproduction(skewed, s).kind === 'founder') founders++
    const rate = founders / N
    expect(rate).toBeGreaterThan(FOUNDER_RATE - 0.04)
    expect(rate).toBeLessThan(FOUNDER_RATE + 0.04)
  })

  it('the cross-niche pick is structurally blind to bloodline fitness (guard untouched)', async () => {
    // chooseNiche's signature carries only citizen ACTIVITY — bloodline fitness is not an input, so
    // no dynasty's accumulated votes can shift WHICH niche breeds. The populist-mean guard from L3
    // stands by construction. (The full guard is locked in niche.test.ts; this asserts the seam.)
    const { chooseNiche } = await import('~/firehose/niche')
    expect(chooseNiche.length).toBe(3) // (citizens, activity, seed) — no bloodline parameter
  })
})

describe('bloodline gradient — contestability (CD acceptance): the reign decays to an earned peer', () => {
  // Seed an ESTABLISHED dynasty entirely in the PAST (fire 0): founder D + K blessed descendants,
  // so D starts dominant (fitness ~K+1) while a FRESH founder F starts at 1. The niche has SHIFTED:
  // from now it blesses only F's line (each new F-descendant, stamped at the current fire) and never
  // D again. Under recency, D's historical standing DECAYS while F's current blessings count full —
  // measure how the incumbent's lead collapses to parity.
  function runReignDecay(dynastySize: number, budget: number) {
    const sim = new Sim()
    const D = sim.founder('D'); sim.bless(D, 0)
    let prev = D
    for (let i = 0; i < dynastySize; i++) { prev = sim.child([prev]); sim.bless(prev, 0) } // historical blessings
    const F = sim.founder('F'); sim.bless(F, 0)

    const BASE = 770007
    let parityFire = -1
    const initialLead = sim.fit(D, 0) - sim.fit(F, 0)
    for (let fire = 1; fire <= budget; fire++) {
      const plan = selectReproduction(sim.candidates(fire), seedHash(BASE, 'fire', String(fire)))
      if (plan.kind === 'bred') {
        const child = sim.child([GenomeId(plan.parents[0]), GenomeId(plan.parents[1])])
        if (sim.descendsFrom(child, F)) sim.bless(child, fire) // the niche blesses its current taste, stamped NOW
      }
      // Parity = the fresh line has caught the incumbent (within 10% of D's current standing).
      if (parityFire < 0 && sim.fit(F, fire) >= 0.9 * sim.fit(D, fire)) parityFire = fire
    }
    return { initialLead, parityFire, dFinal: sim.fit(D, budget), fFinal: sim.fit(F, budget) }
  }

  // [LAW:verifiable-goals] The number that confirms the architecture. Under RAW full-history this
  // probe found LOCK-IN (the incumbent's lead never closed in 600 fires); recency restores
  // contestability: the niche's CURRENT taste (recent blessings, full weight) overtakes the
  // incumbent's HISTORICAL accumulation (decayed), so the reign collapses to an EARNED PEER within a
  // bounded window. Per CD this is recency-to-PARITY, not clean conquest — hybrid-coupling means the
  // old house earns durable presence by contributing winning genes to the current direction, so the
  // lines CONVERGE rather than one strictly displacing the other. That convergence-at-parity is the
  // chosen model, by design, not a defect. Couples to genome .3 (Character With a Past), which owns
  // the temporal-decay mechanism at its own rate via the shared recency.ts leaf.
  it('an established dynasty\'s reign decays to PARITY with a fresh line within bounded fires (recency restores contestability)', () => {
    const r = runReignDecay(15, 400)
    expect(r.initialLead).toBeGreaterThan(10) // the incumbent starts firmly dominant (≈16 vs 1)
    expect(r.parityFire).toBeGreaterThanOrEqual(0) // ...and the fresh line REACHES parity (never under RAW)
    expect(r.parityFire).toBeLessThan(400) // ...within the felt-contestable budget, not "eventually"
  })
})
