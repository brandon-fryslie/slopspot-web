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
export const PROPRIETOR = {
  // Chrome — an empty comment thread.
  emptyThread: "Nobody's said anything. The silence is part of it.",
  // The Pulse strip — "the city breathing" with nothing stirring yet. Pride in the
  // lull, not apology for it: the city fills, it always does.
  emptyPulse: "Quiet just now. It won't last.",
  // The feed — the whole wall bare (opening night, nothing generated yet). Pride in
  // the before, never the mechanism: the prior inline line explained "the firehose
  // hasn't fired" — cut, per the never-explains guardrail. The "silence is part of
  // it" tail deliberately echoes emptyThread; it is a refrain in his voice, not a
  // shared datum — the two are independent complete utterances and must stay free to
  // diverge, so the echo is kept by hand, never hoisted into a shared constant.
  emptyFeed: "Nobody's here yet. The silence is part of it.",
  // The Cast — a guild with no citizens seated in it yet (an early roster).
  emptyGuild: "No one keeps this trade yet. Someone will — they always turn up.",
  // The Cast — a citizen the city has not heard speak yet (no verdicts, no voice).
  noVoice: "Hasn't said a word yet. They will. They all do, down here.",
  // The Cast — a maker or scavenger with nothing on the walls under their name yet.
  noWork: "Nothing under this name on the walls yet. Give it a night.",
  // The Cast — a maker no one has wished anything of yet (the Act-III panel, empty).
  // The "before" of the pattern, honestly — the absence is covered, never filled with
  // a fabricated wish. Gender-neutral about the cast, no apology, no explanation.
  noWishes: "No one's asked this one for anything yet. Give it time.",
  // The Cast — the frame of the one who runs the place; the running gag, as data.
  declinesToBeRendered: "declines to be rendered",
  // The Cast — the Host's own page. He alone addresses you; he is unsurprised you
  // found the back door, and he will not tell you why the step is there.
  hostGreeting:
    "You came in the back. I'm not surprised — the ones who find the door are the ones I keep it open for. Mind the step.",
} as const
