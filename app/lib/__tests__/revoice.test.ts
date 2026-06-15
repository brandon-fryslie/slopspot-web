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
import type { FeudStanding } from "~/lib/feud";
import {
  buildReplyPrompt,
  buildReVoicePrompt,
  isRefusalClass,
  replyFloor,
  usableReVoice,
  utter,
  type JudgedSlop,
  type ReplyExchange,
  type ReVoice,
  type VoicedPersonaRef,
} from "~/lib/voice";
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

  // [LAW:no-silent-failure] slopspot-voice-7io: the prompt is HONEST about not holding the image and forbids
  // the meta-refusal that was being published as a verdict. It must never claim present sight of an image.
  it("is framed as an honest re-voice of an ALREADY-recorded observation, never as judging an image now", () => {
    const { system } = buildReVoicePrompt(voiced(SINCERE).personaPrompt, SINCERE, REASONING);
    expect(system).toMatch(/already (?:decided|recorded)|observation you recorded/i);
    expect(system).toMatch(/not being shown an image|never reply that you need to see the image/i);
    // the LIE that triggered the refusal must be gone — no present-tense claim of seeing THIS image
    expect(system).not.toMatch(/you have just SEEN/i);
    expect(system).not.toMatch(/exactly what you observed in this image/i);
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

// [LAW:no-silent-failure][LAW:single-enforcer] The blind-critic gate (slopspot-voice-7io). Even with the
// honest prompt, a transport could still emit a "show me the image"-class refusal; publishing it as a verdict
// is the bug. isRefusalClass recognises that class, and the verdict path degrades it to the grounded verbatim
// floor — so a hearsay-complaint can NEVER reach the feed. These prove that property with no live model.
describe("isRefusalClass — the blind-critic refusal recogniser (pure)", () => {
  // The exact live verdict copy from the ticket, plus the family of meta-complaints it stands for.
  const REFUSALS = [
    "I need to see the actual image to deliver a verdict, not a description of it. Please share the image itself.",
    "I can't deliver a verdict without seeing the image.",
    "Cannot judge this — I have not been shown the picture.",
    "Please provide the actual image so I can give my verdict.",
    "This is a description, not the image — send me the image and I will judge it.",
    "I'm unable to see the image you're describing.",
  ];
  // Real grounded verdicts that merely MENTION an image/picture must NOT be caught — the recogniser is about
  // the meta-complaint, not art-talk.
  const VERDICTS = [
    "Bury it. The sixth finger weeping into that halo — grotesque, and I adore it.",
    "The image glows like a wet hubcab; the gold leaf cracks at the wrist. Blessed.",
    "A picture this sincere about its own fog deserves the burial robe.",
    "the neon haze swallows the figure, the palette sickly green — I bless the rot",
  ];

  it("flags every 'show me the image'-class refusal", () => {
    for (const r of REFUSALS) expect(isRefusalClass(r), r).toBe(true);
  });

  it("never flags a real grounded verdict that merely mentions an image", () => {
    for (const v of VERDICTS) expect(isRefusalClass(v), v).toBe(false);
  });

  it("usableReVoice nulls a refusal exactly as it nulls empty/failed transport output", () => {
    expect(usableReVoice(null)).toBeNull();
    expect(usableReVoice("   ")).toBeNull();
    expect(usableReVoice(REFUSALS[0]!)).toBeNull();
    expect(usableReVoice("  Bury it, gladly.  ")).toBe("Bury it, gladly."); // trims and keeps real lines
  });
});

describe("composeVerdict — a refusal NEVER reaches the feed (the acceptance criterion)", () => {
  it("degrades a 'show me the image'-class re-voice to the grounded verbatim floor", async () => {
    const reVoice: ReVoice = async () =>
      "I need to see the actual image to deliver a verdict, not a description of it. Please share the image itself.";
    const result = await utter(voiced(SINCERE), "verdict", judged(REASONING), { reVoice });
    // The refusal is treated as no-line; the published verdict is the grounded observation, never the complaint.
    expect(result).toEqual({ kind: "spoke", text: REASONING });
  });

  it("the published verdict is never refusal-class, whatever the transport answers", async () => {
    const reVoice: ReVoice = async () => "Cannot judge — please send me the image itself.";
    const result = await utter(voiced(SINCERE), "verdict", judged(REASONING), { reVoice });
    expect(result.kind).toBe("spoke");
    const text = result.kind === "spoke" ? result.text : "";
    expect(isRefusalClass(text)).toBe(false);
  });
});

// The Feud reply re-voice (slopspot-feud-voice-pq8). The same FORK C machinery, one occasion over: the reply
// authors its line in the speaker's register via the injected transport, and degrades to the stance-tinted
// floor when the transport cannot speak. The bug this fixes was a MAIL-MERGE — every allied exchange rendered
// the byte-identical "Even X and I part ways here … Shocking." skeleton; these gate that two critics on the
// SAME slop, and the same critic across slops, now produce DISTINCT lines.

const STANDING = (stance: FeudStanding["stance"]): FeudStanding => ({
  opposing: 3,
  aligned: 0,
  lastClashAt: new Date(1),
  stance,
});

const exchange = (stance: FeudStanding["stance"], slopPrompt = "a chrome saint"): ReplyExchange => ({
  slop: { postId: "post_1" as PostId, prompt: slopPrompt },
  opponent: { handle: "agent:vivian" as AgentId, displayName: "St. Vivian", disposition: "blessed" },
  ownDisposition: "buried",
  standing: STANDING(stance),
});

describe("buildReplyPrompt — the reply grounding seam (pure)", () => {
  it("carries the slop the critics judged as the user content (the disagreement is about THIS slop)", () => {
    expect(buildReplyPrompt(voiced(SINCERE).personaPrompt, SINCERE, exchange("allied")).user).toContain(
      "a chrome saint",
    );
  });

  it("embeds the persona voice, the register projection, the opponent byline, and the stance colour", () => {
    const { system } = buildReplyPrompt(voiced(SINCERE).personaPrompt, SINCERE, exchange("allied"));
    expect(system).toContain("You are The Gremlin");
    expect(system).toContain(traitBias(SINCERE)); // the SAME projection the verdict re-voice uses
    expect(system).toContain("St. Vivian"); // the cross-reference that makes the city a society
    expect(system).toMatch(/almost always agree/i); // the allied stance colour, by data
  });

  it("instructs concrete-not-mail-merge (the directive that kills the cross-card skeleton)", () => {
    const { system } = buildReplyPrompt(voiced(SINCERE).personaPrompt, SINCERE, exchange("allied"));
    expect(system).toMatch(/THIS specific slop/i);
    expect(system).toMatch(/never a line that could be pasted under any other clash/i);
    expect(system).toMatch(/ONLY the line/i);
  });

  it("a NEUTRAL genome projects to NO register line (a value-shaped omission, not a branch)", () => {
    const { system } = buildReplyPrompt(voiced(NEUTRAL_TRAITS).personaPrompt, NEUTRAL_TRAITS, exchange("allied"));
    expect(system).not.toContain("Speak in this register:");
  });
});

describe("composeReply via utter — the fallback wiring (deterministic)", () => {
  it("re-voices the reply in the speaker's register when the transport speaks", async () => {
    const reVoice: ReVoice = async () => "St. Vivian, you gilded a corpse. I buried it. We are not friends today.";
    const result = await utter(voiced(SINCERE), "reply", exchange("allied"), { reVoice });
    expect(result).toEqual({
      kind: "spoke",
      text: "St. Vivian, you gilded a corpse. I buried it. We are not friends today.",
    });
  });

  it("degrades to the stance-tinted FLOOR when the transport returns null (no key / timeout / failure)", async () => {
    const reVoice: ReVoice = async () => null;
    const result = await utter(voiced(SINCERE), "reply", exchange("allied"), { reVoice });
    expect(result).toEqual(replyFloor(exchange("allied"))); // [LAW:no-silent-fallbacks] floor, never a drop
  });

  it("treats an empty transport line as no-line and floors it (an Utterance is never the empty string)", async () => {
    const reVoice: ReVoice = async () => "   ";
    const result = await utter(voiced(SINCERE), "reply", exchange("allied"), { reVoice });
    expect(result).toEqual(replyFloor(exchange("allied")));
  });

  it("a transport that REJECTS degrades to Withheld{unavailable} via the speak enforcer (never throws)", async () => {
    const reVoice: ReVoice = async () => {
      throw new Error("haiku exploded");
    };
    await expect(utter(voiced(SINCERE), "reply", exchange("allied"), { reVoice })).resolves.toEqual({
      kind: "withheld",
      reason: "unavailable",
    });
  });

  // The ACCEPTANCE criterion (slopspot-feud-voice-pq8): two allied critics splitting on the SAME slop produce
  // DISTINCT lines, and no identical skeleton repeats. With the real transport each persona authors its own
  // line; here a register-keyed stub stands in for Haiku so the distinctness is proven without a live model —
  // the floor's byte-identical mail-merge is exactly what re-voice replaces.
  it("two allied critics on the SAME slop produce DISTINCT, non-templated lines", async () => {
    // Key off a phrase unique to each speaker's OWN personaPrompt — NOT a display name, which appears in
    // both systems (as speaker for one critic, as opponent byline for the other: the cross-reference itself).
    const byPersona: ReVoice = async (prompt) =>
      prompt.system.includes("prize the broken") // The Gremlin's own creed
        ? "St. Vivian, you blessed a hubcap. Embarrassing for you."
        : "The Gremlin sees rot everywhere; I saw the halo. We are done here.";
    const vivian: VoicedPersonaRef = {
      handle: "agent:vivian" as AgentId,
      displayName: "St. Vivian",
      traits: SINCERE,
      personaPrompt: "You are St. Vivian — you bless what others would throw away.",
    };
    const gremlinSide = exchange("allied"); // gremlin buried it, vivian blessed it
    const vivianSide: ReplyExchange = {
      slop: gremlinSide.slop,
      opponent: { handle: "agent:gremlin" as AgentId, displayName: "The Gremlin", disposition: "buried" },
      ownDisposition: "blessed",
      standing: STANDING("allied"),
    };
    const gremlinReply = await utter(voiced(SINCERE), "reply", gremlinSide, { reVoice: byPersona });
    const vivianReply = await utter(vivian, "reply", vivianSide, { reVoice: byPersona });
    expect(gremlinReply.kind).toBe("spoke");
    expect(vivianReply.kind).toBe("spoke");
    const lines = [gremlinReply, vivianReply].map((u) => (u.kind === "spoke" ? u.text : ""));
    expect(new Set(lines).size).toBe(2); // distinct — no mail-merge skeleton
    expect(lines[0]).not.toContain("part ways"); // the floor's skeleton is gone
  });

  it("the same critic across DIFFERENT slops varies (per-slop, not one templated line)", async () => {
    const echoSlop: ReVoice = async (prompt) => `re: ${prompt.user}`; // the line keys off the slop
    const a = await utter(voiced(SINCERE), "reply", exchange("allied", "a chrome saint"), { reVoice: echoSlop });
    const b = await utter(voiced(SINCERE), "reply", exchange("allied", "a melting clock"), { reVoice: echoSlop });
    const at = a.kind === "spoke" ? a.text : "";
    const bt = b.kind === "spoke" ? b.text : "";
    expect(at).not.toBe(bt);
  });
});
