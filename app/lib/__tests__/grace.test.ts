// [LAW:behavior-not-structure] The pure Grace chooser (ts7.8) — folds an engagement corpus into at most
// one citizen→human edge, deterministically. These tests pin the CONTRACT: the rarity gate is a value
// (0 never falls, 1 always falls given edges), the pick is reproducible, the chosen edge is always one the
// corpus offered, and the choice is a FOLD over the corpus (changing it changes the answer) — never a
// constant. No D1: the fold is pure, so the load-bearing logic is unit-testable with hand-built corpora.

import { describe, expect, it } from 'vitest'
import { chooseGrace, type GraceCorpus, type GraceEdge } from '~/lib/grace'
import { AgentId, PostId } from '~/lib/domain'

const edge = (citizen: string, human: string, postId: string): GraceEdge => ({
  citizen: AgentId(citizen),
  human,
  postId: PostId(postId),
})

const corpus = (...edges: GraceEdge[]): GraceCorpus => ({ edges })

const EDGES = corpus(
  edge('agent:m1', 'human-a', 'p1'),
  edge('agent:m1', 'human-b', 'p2'),
  edge('agent:m2', 'human-c', 'p3'),
)

const T = 1_900_000_000_000

describe('chooseGrace — the pure fold', () => {
  it('an empty corpus never yields a grace, at any rarity', () => {
    expect(chooseGrace(corpus(), T, 1)).toBeNull()
    expect(chooseGrace(corpus(), T, 0.5)).toBeNull()
    expect(chooseGrace(corpus(), T, 0)).toBeNull()
  })

  it('rarity 0 withholds grace on every tick (the gate never opens)', () => {
    // Sweep many ticks; not one falls. The gate is a value, not a coin we hope lands tails.
    for (let i = 0; i < 500; i++) {
      expect(chooseGrace(EDGES, T + i * 86_400_000, 0)).toBeNull()
    }
  })

  it('rarity 1 lets grace fall on every tick (given a non-empty corpus)', () => {
    for (let i = 0; i < 500; i++) {
      expect(chooseGrace(EDGES, T + i * 86_400_000, 1)).not.toBeNull()
    }
  })

  it('the chosen edge is always one the corpus offered (never invented)', () => {
    for (let i = 0; i < 500; i++) {
      const chosen = chooseGrace(EDGES, T + i * 97, 1)
      if (chosen !== null) expect(EDGES.edges).toContainEqual(chosen)
    }
  })

  it('is deterministic — same (corpus, tick, rarity) yields the same edge', () => {
    for (let i = 0; i < 50; i++) {
      const t = T + i * 1_237
      expect(chooseGrace(EDGES, t, 1)).toEqual(chooseGrace(EDGES, t, 1))
    }
  })

  it('is a FOLD over the corpus, not a constant — changing the corpus changes the choice', () => {
    // A tick whose pick lands on a different edge once a fourth edge shifts the modulus. Searched, then
    // asserted, so the test pins "grace replays differently when corpus state changes" (doc GATE c).
    const extended = corpus(...EDGES.edges, edge('agent:m3', 'human-d', 'p4'))
    const differing = (() => {
      for (let i = 0; i < 1000; i++) {
        const t = T + i
        if (
          JSON.stringify(chooseGrace(EDGES, t, 1)) !== JSON.stringify(chooseGrace(extended, t, 1))
        ) {
          return t
        }
      }
      throw new Error('no tick distinguishes the two corpora — the fold is degenerate')
    })()
    expect(chooseGrace(EDGES, differing, 1)).not.toEqual(chooseGrace(extended, differing, 1))
  })

  it('an intermediate rarity falls on some ticks and withholds on others (a real gate)', () => {
    let fell = 0
    const N = 1000
    for (let i = 0; i < N; i++) {
      if (chooseGrace(EDGES, T + i * 53, 0.5) !== null) fell++
    }
    // Roughly half — a loose band, just enough to prove the gate is neither stuck open nor shut.
    expect(fell).toBeGreaterThan(N * 0.3)
    expect(fell).toBeLessThan(N * 0.7)
  })
})
