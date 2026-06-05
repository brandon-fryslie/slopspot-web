// The feud standing — a citizen's DERIVED relationship to another, a pure function of their shared
// verdict history (slopspot-voice-w2v.2). [LAW:one-source-of-truth] there is NO stored feud status;
// the standing is read from the utterance/vote records the way score is read as SUM(votes). The named
// rivalries (the-cast.md: Gremlin↔Vesper, Vivian↔Gremlin) EMERGE here from the records — they are not
// duplicated as state.

export type FeudStance = 'feuding' | 'allied' | 'wary' | 'neutral'

// The derived relationship between two citizens. `opposing`/`aligned` are the magnitude (how much
// shared history, and which way it leans); `stance` is the qualitative tier; `lastClashAt` is the
// recency hook .3 (Character With a Past) tints future voice onto — carried now, with no decay
// consumer in .2 [variability-at-edges].
export type FeudStanding = {
  readonly opposing: number // slops both citizens verdicted with OPPOSING dispositions (bless vs bury)
  readonly aligned: number // slops both verdicted with the SAME disposition
  readonly lastClashAt: Date | null // the most recent opposing pair, or null if they have never clashed
  readonly stance: FeudStance
}

// [LAW:types-are-the-program][enumeration-gap] A TOTAL, deterministic classification of the
// (opposing, aligned) count plane into exactly one stance. The accept table — proven to PARTITION ℕ²
// (every non-negative pair maps to exactly one tier; the four cases are mutually exclusive and
// exhaustive):
//
//   (0, 0)                  → neutral   no shared verdicts at all — strangers
//   opposing  >  aligned    → feuding   clash more than agree (incl. the first lone clash: o≥1, a=0)
//   aligned   >  opposing    → allied   agree more than clash (incl. a≥1, o=0)
//   opposing == aligned (>0) → wary     clash and agree equally — a complicated, uneasy standing
//
// Mutual exclusion: the cases split on (=, >, <) of two numbers plus the zero/non-zero of the equal
// case — no two predicates are ever both true. Exhaustive: every pair is =, >, or <, and the equal
// case is split by the leading (0,0) guard, so the final `return` is the exhaustive catch, never a
// guessed default. MAGNITUDE (how HOT a feud runs) is the `opposing` count, carried in FeudStanding
// separately — the stance is the lean, the count is the heat.
export function stanceOf(opposing: number, aligned: number): FeudStance {
  if (opposing === 0 && aligned === 0) return 'neutral'
  if (opposing > aligned) return 'feuding'
  if (aligned > opposing) return 'allied'
  // opposing === aligned AND both > 0 (the (0,0) case was caught above) — the exhaustive remainder.
  return 'wary'
}
