// [LAW:one-type-per-behavior] The Gremlin NOTICES inbreeding through the EXISTING voice occasion — a
// `verdict`: a critic passing judgment on a slop. There is NO new occasion and no parallel remark path; the
// structural inbreeding signal is carried as the verdict's `reasoning` (its substance), the same seam the
// image-grounded take rides. The disposition is -1 (buried): the city's skeptic disapproves of a bloodline
// crossed back into its own near-kin — comedy on purpose, per design-docs/the-breeding-room.md.
//
// [LAW:dataflow-not-control-flow] A page renders this from the DETERMINISTIC FLOOR — `reVoice` returns null,
// so utter('verdict', …) degrades to spoke(reasoning) verbatim. No live LLM rides a page render (the gate's
// assertion target); the register-decorated re-voice is the recorded-vote path's concern, not this derived
// annotation's. [LAW:one-way-deps] a pure leaf over voice.ts + the distance measurement; no env, no I/O.

import { utter, type ReVoice, type SlopGist, type Utterance, type VoicedPersonaRef } from '~/lib/voice'
import type { GeneticDistance } from '~/lib/genome-distance'

// [LAW:single-enforcer] The Gremlin's TAKE on an inbred cross — the ONE place the inbreeding signal becomes
// words. Pure and deterministic: it names the closeness (how few genes apart, how little the traits moved),
// so the line could ONLY have been written about THIS pair — the same this-slop-only grounding the verdict
// re-voice demands. The verdict floor speaks it verbatim, so this string IS the rendered line.
export function inbreedingReasoning(distance: GeneticDistance): string {
  const genes =
    distance.geneMismatches === 0
      ? 'not one gene apart'
      : `only ${distance.geneMismatches} gene${distance.geneMismatches === 1 ? '' : 's'} apart`
  return `Those two parents are ${genes}, their traits all but identical — this one was bred from its own near-twin. That isn't a bloodline, it's a hall of mirrors. Inbred. Buried.`
}

// [LAW:dataflow-not-control-flow] The page's re-voice transport: a constant that always declines, so every
// inbreeding aside degrades to its deterministic floor. Not a failure — a deliberate "do not pay for an LLM
// here", the same null the recorded-vote transport returns when it cannot speak. [LAW:no-silent-failure] the
// floor is a real, complete line, never an empty fallback.
export const FLOOR_ONLY_REVOICE: ReVoice = async () => null

// The Gremlin's inbreeding remark as an Utterance, produced through the locked `utter` contract. The vote is
// -1 (buried) and makerHandle is null: this aside is about the CROSS, not a feud with whoever bred it. With
// the default floor-only transport the result is a deterministic spoke(line); a caller that wants the
// register-decorated version injects a real reVoice (the recorded-vote path's transport).
export function gremlinInbreedingRemark(
  gremlin: VoicedPersonaRef,
  slop: SlopGist,
  distance: GeneticDistance,
  reVoice: ReVoice = FLOOR_ONLY_REVOICE,
): Promise<Utterance> {
  return utter(
    gremlin,
    'verdict',
    { slop, vote: -1, makerHandle: null, reasoning: inbreedingReasoning(distance) },
    { reVoice },
  )
}
