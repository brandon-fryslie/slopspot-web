// The Proprietor's chrome voice — the site's empty / loading / missing states,
// spoken by one mouth. Lines are transcribed verbatim from
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
// Each surface adds its line here as it comes to need it — the module grows by
// consumption, never by speculation, so every entry has a live caller.
export const PROPRIETOR = {
  // Chrome — an empty comment thread.
  emptyThread: "Nobody's said anything. The silence is part of it.",
} as const
