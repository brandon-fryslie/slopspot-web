// [LAW:behavior-not-structure] FORK C's CI-DETERMINISTIC gate (slopspot-voice-w2v.7). The re-voice has
// two halves: a STOCHASTIC property (does the rendered line keep this-slop-only specifics, in the right
// register) gated by the eval harness against real Haiku pre-deploy; and the DETERMINISTIC seam — the
// prompt construction and the fallback wiring — gated HERE, with no live model. This file proves the
// MACHINERY: buildReVoicePrompt embeds register + verbatim observations + the grounding directive, and
// composeVerdict (via utter) re-voices when the transport speaks, degrades to the verbatim floor when it
// cannot, and withholds when there is nothing to say. The eval gate never pretends to run here; this gate
// never pretends to be the property.

import { describe, expect, it } from "vitest";
import type { AgentId, PostId, TraitVector } from "~/lib/domain";
import { buildReVoicePrompt, utter, type JudgedSlop, type ReVoice, type VoicedPersonaRef } from "~/lib/voice";
import { traitBias } from "~/lib/register";
import { NEUTRAL_TRAITS } from "~/lib/traits";

const SINCERE: TraitVector = { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.95 };
const REASONING = "the sixth finger melts into the halo and the gold leaf is cracked at the wrist";

const voiced = (traits: TraitVector): VoicedPersonaRef => ({
  handle: "agent:gremlin" as AgentId,
  displayName: "The Gremlin",
  traits,
  personaPrompt: "You are The Gremlin — you bury the precious and prize the broken.",
});

const judged = (reasoning?: string): JudgedSlop => ({
  slop: { postId: "post_1" as PostId, prompt: "a chrome saint" },
  vote: -1,
  makerHandle: null,
  ...(reasoning !== undefined ? { reasoning } : {}),
});

describe("buildReVoicePrompt — the grounding seam (pure)", () => {
  it("carries the verbatim observations as the user content (the substance is never paraphrased away)", () => {
    expect(buildReVoicePrompt(voiced(SINCERE).personaPrompt, SINCERE, REASONING).user).toBe(REASONING);
  });

  it("embeds the persona voice and the register projection (the SAME traitBias the image composer uses)", () => {
    const { system } = buildReVoicePrompt(voiced(SINCERE).personaPrompt, SINCERE, REASONING);
    expect(system).toContain("You are The Gremlin");
    expect(system).toContain(traitBias(SINCERE)); // the register steer, verbatim from the one projection
  });

  it("instructs PRESERVE-the-specifics, not blind-writable mush (FORK C's grounding directive)", () => {
    const { system } = buildReVoicePrompt(voiced(SINCERE).personaPrompt, SINCERE, REASONING);
    expect(system).toContain("PRESERVE");
    expect(system).toMatch(/could ONLY come from having seen/i);
    expect(system).toMatch(/launder/i);
    expect(system).toMatch(/ONLY the verdict line/i);
  });

  it("a NEUTRAL genome projects to NO register line (a value-shaped omission, not a branch)", () => {
    const { system } = buildReVoicePrompt(voiced(NEUTRAL_TRAITS).personaPrompt, NEUTRAL_TRAITS, REASONING);
    expect(traitBias(NEUTRAL_TRAITS)).toBe(""); // precondition: neutral steers to ''
    expect(system).not.toContain("Speak in this register:");
  });
});

describe("composeVerdict via utter — the fallback wiring (deterministic)", () => {
  it("re-voices the substance when the transport speaks", async () => {
    const reVoice: ReVoice = async () => "Bury it. The sixth finger weeping into that halo — grotesque, and I adore it.";
    const result = await utter(voiced(SINCERE), "verdict", judged(REASONING), { reVoice });
    expect(result).toEqual({
      kind: "spoke",
      text: "Bury it. The sixth finger weeping into that halo — grotesque, and I adore it.",
    });
  });

  it("degrades to the VERBATIM floor when the transport returns null (no key / timeout / failure)", async () => {
    const reVoice: ReVoice = async () => null;
    const result = await utter(voiced(SINCERE), "verdict", judged(REASONING), { reVoice });
    // [LAW:no-silent-fallbacks] degrade to the grounded verbatim observation — behaviour-identical to the
    // w2v.1 floor — never a dropped verdict.
    expect(result).toEqual({ kind: "spoke", text: REASONING });
  });

  it("withholds (indifferent) when there is no reasoning — the presence of substance is the discriminator", async () => {
    const reVoice: ReVoice = async () => "should never be called";
    const result = await utter(voiced(SINCERE), "verdict", judged(undefined), { reVoice });
    expect(result).toEqual({ kind: "withheld", reason: "indifferent" });
  });

  it("a transport that REJECTS degrades to Withheld{unavailable} via the speak enforcer (never throws)", async () => {
    const reVoice: ReVoice = async () => {
      throw new Error("haiku exploded");
    };
    await expect(utter(voiced(SINCERE), "verdict", judged(REASONING), { reVoice })).resolves.toEqual({
      kind: "withheld",
      reason: "unavailable",
    });
  });

  it("passes the BUILT prompt to the transport (the seam is wired, not bypassed)", async () => {
    let seen: { system: string; user: string } | null = null;
    const reVoice: ReVoice = async (prompt) => {
      seen = prompt;
      return "ok";
    };
    await utter(voiced(SINCERE), "verdict", judged(REASONING), { reVoice });
    expect(seen).toEqual(buildReVoicePrompt(voiced(SINCERE).personaPrompt, SINCERE, REASONING));
  });
});
