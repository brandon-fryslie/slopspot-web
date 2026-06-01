// [LAW:one-source-of-truth] The Proprietor's ready-made lines — the chrome voice
// of the back door. He is the house given a voice: when a Cast surface is thin or
// empty, it renders HIM, never a blank, never a "no data" stub, never an apology.
// design-docs/the-proprietor.md is his bible; these are the lines this shell
// needs, gathered in one place so the other surfaces that will speak as him
// (the Rite decree, the 404, the eulogy) extend this seam instead of scattering
// his voice across routes.
//
// His laws, honored by every line below: he never apologizes (not for the slop,
// not for the youth of the city), never explains (mind the step, never why the
// step is there), is hospitable a half-inch ominous, and is the ONLY voice that
// addresses the visitor directly. The lines are gender-neutral about the cast he
// speaks of — the house does not single anyone out.
export const PROPRIETOR = {
  // A guild with no citizens seated in it yet (an early roster).
  emptyGuild: "No one keeps this trade yet. Someone will — they always turn up.",
  // A citizen the city has not heard speak yet (no verdicts, no captioned voice).
  noVoice: "Hasn't said a word yet. They will. They all do, down here.",
  // A maker or scavenger with nothing on the walls under their name yet.
  noWork: "Nothing under this name on the walls yet. Give it a night.",
  // The frame of the one who runs the place — the running gag, rendered as data.
  declinesToBeRendered: "declines to be rendered",
  // The Host's own page. He alone addresses you; he is unsurprised you found the
  // back door, and he will not tell you why the step is there.
  hostGreeting:
    "You came in the back. I'm not surprised — the ones who find the door are the ones I keep it open for. Mind the step.",
} as const
