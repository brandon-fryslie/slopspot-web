// [LAW:single-enforcer] The ONE place a TraitVector becomes authoring steer. The genome's four
// traits ARE registers — directions a citizen's sensibility leans — and this is the single
// projection from those continuous dials into the language that bends a composition. There is no
// second projection: the image composer and the voice layer both embed THIS string.
//
// [LAW:one-source-of-truth] R1 made structural: the TraitVector is the lone source; `traitBias` is
// a pure projection of it. A parallel "voice register" beside an "image register" is exactly the
// divergence this forbids — a citizen that LOOKS sincere but SPEAKS ironic, a being at war with
// itself. Both surfaces being deterministic functions of one vector makes that contradiction
// unrepresentable. The steer is therefore MEDIUM-AGNOSTIC: it names devices and directions an LLM
// applies to whatever it authors (pixels when composing an image, words when composing a remark),
// never image-only or voice-only vocabulary.
//
// [LAW:one-way-deps] Lives in `lib` so BOTH consumers sit downstream: `firehose/composer` (image,
// now) and `lib/voice` (speech, when it goes LLM-backed). If this lived in the composer, voice ->
// composer would be a back-edge; lifting the shared projection up names the type both depend on.

import type { TraitVector } from '~/lib/domain'

// [LAW:types-are-the-program] Each axis is bipolar; a pole is the register that end of the dial
// reaches for, written as a NOUN PHRASE so a commitment lead-in ("lean toward …", "push hard
// toward …") reads naturally before it. EARNESTNESS is the lever and is NOT symmetric "more/less":
// it is DROP-vs-ADD of distancing devices (mask vs face). The sincere pole drops every device; the
// ironic pole keeps them. The vocabulary is the city's, from the corpus — not invented here.
const POLES: Record<keyof TraitVector, { readonly low: string; readonly high: string }> = {
  austerity: {
    low: 'austerity — spare, stark, unadorned, a single form in vast negative space, reduced to one gesture, nothing extra, silence around the subject',
    high: 'baroque ornament — encrusted, gilded, every surface worked, filigree and rococo excess, more-is-more, the frame dense with ornament',
  },
  curse: {
    low: 'cleanness — whole, correct, unbroken, anatomically true, lucid, no glitch, serene competence, nothing to forgive',
    high: 'the cursed register — wrong-in-the-right-way, too many fingers or teeth, melting, glitch-sublime, uncanny, the seams showing, dread under the gloss, the machine dream-error made holy',
  },
  density: {
    low: 'sparseness — a single subject, empty around it, one figure in a void, isolated, vast emptiness, a thing alone in space',
    high: 'density — teeming, packed, a crowd, every inch occupied, swarming, overgrown, no empty space, the frame barely holding it',
  },
  // [LAW:types-are-the-program] THE LEVER. sincere = undefended (devices DROPPED), NOT pleasant/
  // wholesome (that warm pole is the Populist mirror — still a defended pose). Any feeling shown
  // without a wink counts. The drop-vs-add is what moves the words; the soul-test gates it.
  earnestness: {
    low: 'irony, defended — KEEP the distancing devices: ironic juxtaposition, camp, kitsch, a self-referential winking frame, the feeling held in scare-quotes, deadpan; hold the subject at arm’s length, in on its own joke',
    high: 'sincerity, undefended — DROP every distancing device: no ironic juxtaposition, no camp, no kitsch, no self-referential or winking frame, no scare-quotes around the feeling, no deadpan; render the subject devotionally, gazed at as if it genuinely matters, the feeling shown without protection — mean it and do not look away',
  },
}

// Below this lean the axis is effectively neutral and contributes nothing — a real "no lean"
// value, the way an empty collection reduces to a no-op. NOT a skipped operation: every axis runs
// the same projection; a neutral one simply projects to the empty string. [LAW:dataflow-not-control-flow]
const NEUTRAL_BAND = 0.1

// [LAW:dataflow-not-control-flow] Commitment scales with distance from neutral — the continuous
// weight, not a binary on/off. `m` in [0,1] selects a lead-in by magnitude (a value lookup, both
// arms yield a phrase — nothing is skipped). The lever is a dial, so faint leans whisper and strong
// leans insist.
const commitment = (m: number): string =>
  m >= 0.66 ? 'push hard toward' : m >= 0.33 ? 'lean toward' : 'tilt toward'

// [LAW:single-enforcer] traits -> one register steer. Same shape for every axis: read the signed
// lean, pick the pole the sign points at (ternary SELECTS a value — dataflow, not an `if` that adds
// a clause only on one side), scale the commitment by magnitude, drop neutral axes from the join.
// Neutral input (the firehose's NEUTRAL_TRAITS) -> '' -> the composer embeds no register line. One
// vector in; the same words bend image and voice alike.
export function traitBias(traits: TraitVector): string {
  const axes = Object.keys(POLES) as (keyof TraitVector)[]
  return axes
    .map((axis) => {
      const lean = traits[axis] - 0.5 // [-0.5, 0.5]
      const m = Math.abs(lean) * 2 // [0, 1]
      const pole = lean >= 0 ? POLES[axis].high : POLES[axis].low
      return m < NEUTRAL_BAND ? '' : `${commitment(m)} ${pole}`
    })
    .filter(Boolean)
    .join('; ')
}
