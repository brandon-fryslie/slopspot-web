// The Proprietor's chrome voice — the site's empty / loading / missing / thin
// states, spoken by one mouth. Lines are transcribed from
// design-docs/the-proprietor.md; surfaces import these constants rather than
// inventing a per-surface line.
//
// [LAW:one-source-of-truth] A thin-state line written inline at a call site is a
// second copy of the Proprietor's voice that drifts the moment another surface
// writes its own. The voice has exactly one home: this module.
//
// The doc's guardrails are absolute and load-bearing — every line here must obey
// them, and a new line that violates them is a bug, not a copy edit:
//   - He NEVER apologizes (no "sorry it's quiet", no apology for the youth of the
//     city). Empty is pride, not a defect.
//   - He NEVER explains (hospitable-ominous; mind the step, never why the step is
//     there).
//   - He alone addresses the visitor directly; the lines are gender-neutral about
//     the cast he speaks of — the house does not single anyone out.
// Each surface adds its line here as it comes to need it — the module grows by
// consumption, never by speculation, so every entry has a live caller. The other
// surfaces that will speak as him (the Rite decree, the 404, the eulogy) extend
// this same seam.

// [LAW:make-it-impossible] A line in the Proprietor's voice is a branded string
// only this module can mint. A raw string is not assignable to ProprietorLine, so
// any TYPED slot that declares it — a chrome config field, a voice component prop —
// rejects an inline literal at compile time: the config-object leak (three found by
// audit, all the same shape) becomes unrepresentable, not a thing review must catch
// each time. The brand sits where a type can sit. A direct `<p>{'…'}</p>` still
// accepts a bare string — React children are untyped that far down — so those
// surfaces stay convention-guarded with their WORDS single-sourced here; a blanket
// "no JSX string literal" lint was weighed and rejected (JSX text is full of
// legitimate non-voice labels, so it is mostly false positives).
declare const PROPRIETOR_LINE: unique symbol
export type ProprietorLine = string & { readonly [PROPRIETOR_LINE]: true }
const line = (text: string): ProprietorLine => text as ProprietorLine

export const PROPRIETOR = {
  // Chrome — an empty comment thread.
  emptyThread: line("Nobody's said anything. The silence is part of it."),
  // The Pulse strip — "the city breathing" with nothing stirring yet. Pride in the
  // lull, not apology for it: the city fills, it always does.
  emptyPulse: line("Quiet just now. It won't last."),
  // The feed — the whole wall bare (opening night, nothing generated yet). Pride in
  // the before, never the mechanism: the prior inline line explained "the firehose
  // hasn't fired" — cut, per the never-explains guardrail. The "silence is part of
  // it" tail deliberately echoes emptyThread; it is a refrain in his voice, not a
  // shared datum — the two are independent complete utterances and must stay free to
  // diverge, so the echo is kept by hand, never hoisted into a shared constant.
  emptyFeed: line("Nobody's here yet. The silence is part of it."),
  // The masthead — his signature aside under the sign, the discreet "you came in the
  // back" register. The same words close hostGreeting ("Mind the step."); like the
  // silence refrain, the echo is a deliberate motif kept by hand — two surfaces, two
  // independent utterances free to diverge — never hoisted into a shared datum.
  mastheadAside: line("mind the step."),
  // The Museum — the Calendar of Saints with no canonisations yet. Pride in the empty
  // drawer ("that is the point"), never apology for the bare hall.
  emptySaints: line(
    'No saints yet. The crown has found no one worthy. It stays in the drawer — that is the point.',
  ),
  // The Museum — the Rogues' Gallery with no beautiful monsters yet. The "give it
  // time" tail echoes noWishes; an honest before, no apology, no mechanism.
  emptyRogues: line('No monsters yet. Nobody has been ugly enough to love. Give it time.'),
  // The Cast — a guild with no citizens seated in it yet (an early roster).
  emptyGuild: line("No one keeps this trade yet. Someone will — they always turn up."),
  // The Cast — a citizen the city has not heard speak yet (no verdicts, no voice).
  noVoice: line("Hasn't said a word yet. They will. They all do, down here."),
  // The Cast — a maker or scavenger with nothing on the walls under their name yet.
  noWork: line("Nothing under this name on the walls yet. Give it a night."),
  // The Cast — a maker no one has wished anything of yet (the Act-III panel, empty).
  // The "before" of the pattern, honestly — the absence is covered, never filled with
  // a fabricated wish. Gender-neutral about the cast, no apology, no explanation.
  noWishes: line("No one's asked this one for anything yet. Give it time."),
  // The Cast — the frame of the one who runs the place; the running gag, as data.
  declinesToBeRendered: line("declines to be rendered"),
  // The Cast — the Host's own page. He alone addresses you; he is unsurprised you
  // found the back door, and he will not tell you why the step is there.
  hostGreeting: line(
    "You came in the back. I'm not surprised — the ones who find the door are the ones I keep it open for. Mind the step.",
  ),
}
