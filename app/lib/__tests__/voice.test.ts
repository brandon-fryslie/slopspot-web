import { describe, expect, it } from "vitest";

import type { AgentId, PostId, ProviderId } from "~/lib/domain";
import type { FeudStanding } from "~/lib/feud";
import {
  type AnsweredWish,
  type ChosenSilenceReason,
  type JudgedSlop,
  type Occasion,
  type OccasionTarget,
  type ReplyExchange,
  type ReVoice,
  type RiteOutcome,
  type WithheldReason,
  spoke,
  speak,
  utter,
  utteranceSchema,
  withheld,
} from "~/lib/voice";

const answerer = {
  handle: "agent:the-well" as AgentId,
  displayName: "The Well",
};

const answeredWish = {
  wish: "a sunset",
  slop: { postId: "post_1" as PostId, prompt: "a sunset over a dead mall" },
};

describe("utter — the locked voice contract", () => {
  it("speaks the remark instance: (answerer, 'remark', AnsweredWish, {}) -> Spoke", async () => {
    const result = await utter(answerer, "remark", answeredWish, {});
    expect(result.kind).toBe("spoke");
    if (result.kind === "spoke") {
      // narrates the gap between wish and slop — never an empty string
      expect(result.text).toContain("a sunset");
      expect(result.text.length).toBeGreaterThan(0);
    }
  });

  it("reads the snapshot without mutating it (one-way dep voice -> domain)", async () => {
    const frozen = Object.freeze({
      wish: "a sunset",
      slop: Object.freeze({
        postId: "post_1" as PostId,
        prompt: "a sunset over a dead mall",
      }),
    });
    await expect(utter(answerer, "remark", frozen, {})).resolves.toMatchObject({ kind: "spoke" });
  });
});

// The Feud Engine (voice-w2v.2): a reply ANSWERS an opposing verdict, and the DERIVED standing's stance
// selects the tone. These assert the dataflow — the stance VALUE picks the register, the opponent is
// named (the cross-reference that makes the city a society), and every stance speaks (never an empty
// string). Blind to the exact wording (the LLM voice swaps the body later); pinned on the contract.
// The Birth Rite (slopspot-growing-cast-7ni.3): the Proprietor welcomes a newborn citizen through the ONE
// Voice mechanism. Pinned on the contract — the newcomer is NAMED, the line is in the host's voice, and
// the occasion takes the BASE speaker + EMPTY caps (no reVoice transport: a birth welcome is freshly
// authored, not a re-voice of an existing take). Blind to exact wording (an LLM voice may swap the body).
describe("utter — the birth instance (The Birth Rite)", () => {
  const proprietor = { handle: "agent:the-proprietor" as AgentId, displayName: "The Proprietor" };
  const newcomer = {
    displayName: "Idris Vane",
    creed: "The room remembers.",
    medium: "verse" as ProviderId,
  };

  it("welcomes the newcomer BY NAME, in the host's voice, carrying the creed (every frame)", async () => {
    const result = await utter(proprietor, "birth", newcomer, {});
    expect(result.kind).toBe("spoke");
    if (result.kind === "spoke") {
      expect(result.text).toContain("Idris Vane"); // the newcomer is named
      expect(result.text).toContain("The Proprietor"); // spoken in the host's voice
      expect(result.text).toContain("The room remembers."); // the creed (the personal core) is preserved
    }
  });

  it("is a deterministic floor — the same newcomer always selects the same frame", async () => {
    const a = await utter(proprietor, "birth", newcomer, {});
    const b = await utter(proprietor, "birth", newcomer, {});
    expect(a).toEqual(b);
  });

  it("rotates through the Proprietor's repertoire by the birth's own hash (different births can differ)", async () => {
    const names = ["Idris Vane", "Sindri Cole", "Marn Okoye", "Petra Voss", "Cass Ueda", "Bo Reyes", "Wren Adler"];
    const frames = new Set<string>();
    for (const displayName of names) {
      const r = await utter(proprietor, "birth", { displayName, creed: "A creed.", medium: "verse" as ProviderId }, {});
      // Normalize the newcomer's name out so we compare FRAMES, not the trivially-different names —
      // two newcomers on the same frame collapse to one entry; distinct frames stay distinct.
      if (r.kind === "spoke") frames.add(r.text.split(displayName).join("<n>"));
    }
    expect(frames.size).toBeGreaterThan(1); // the host has a repertoire, selected by data
  });
});

// The First-Poet Rite (slopspot-beyond-image-poj.4): the Proprietor decrees the city's first poet through
// the ONE Voice mechanism. Pinned on the contract — the poet is NAMED, the line carries the birth day (the
// permanent mark "born [date]") and the creed, in the host's voice, on the BASE speaker + EMPTY caps (a
// freshly authored decree, not a re-voice). Blind to exact wording (an LLM voice may swap the body).
describe("utter — the first-poet instance (The Firehose Writes)", () => {
  const proprietor = { handle: "agent:the-proprietor" as AgentId, displayName: "The Proprietor" };
  const poet = { displayName: "Idris Vane", creed: "The room remembers.", bornOn: "2026-06-05" };

  it("decrees the poet BY NAME, with the birth day and creed, in the host's voice", async () => {
    const result = await utter(proprietor, "first-poet", poet, {});
    expect(result.kind).toBe("spoke");
    if (result.kind === "spoke") {
      expect(result.text).toContain("Idris Vane"); // the poet is named
      expect(result.text).toContain("first poet"); // the honor is pronounced
      expect(result.text).toContain("2026-06-05"); // the permanent mark records the birth day
      expect(result.text).toContain("The room remembers."); // the creed is woven in
      expect(result.text).toContain("The Proprietor"); // spoken in the host's voice
    }
  });

  it("is a deterministic floor — the same poet always yields the same decree", async () => {
    const a = await utter(proprietor, "first-poet", poet, {});
    const b = await utter(proprietor, "first-poet", poet, {});
    expect(a).toEqual(b);
  });
});

// The Third-Person Reveal (slopspot-patronage-ts7.9): the choosing citizen utters its grace to the CITY
// through the ONE Voice mechanism, on the BASE speaker + EMPTY caps (grace does not re-voice). The DAWNING
// is a TYPE guarantee — GraceChoice carries no human field — so these pins witness what the type already
// enforces: the line names the maker and the slop subject, refers to the chosen only obliquely, and can
// carry no human identifier whatsoever.
describe("utter — the grace instance (The Third-Person Reveal)", () => {
  const maker = { handle: "agent:vesper" as AgentId, displayName: "Vesper" };
  const choice = { slop: { postId: "post_grace_1" as PostId, prompt: "a drain at 3am, sodium light" } };

  it("speaks the choice to the CITY — names the maker and the slop subject, addresses no one", async () => {
    const result = await utter(maker, "grace", choice, {});
    expect(result.kind).toBe("spoke");
    if (result.kind === "spoke") {
      expect(result.text).toContain("Vesper"); // the choosing citizen speaks
      expect(result.text.toLowerCase()).toContain("a drain at 3am"); // grounded in the slop subject (first clause)
      // A third-person reveal: the chosen is referred to obliquely, NEVER addressed. No second person.
      expect(result.text).not.toMatch(/\byou\b/i);
      expect(result.text).not.toMatch(/\byour\b/i);
    }
  });

  it("carries NO human identifier — the target has no human field, so the line cannot name one", async () => {
    const result = await utter(maker, "grace", choice, {});
    if (result.kind === "spoke") {
      // No anon-label, no uuid fragment — a tourist reading the line cannot tell who was chosen.
      expect(result.text).not.toMatch(/anon-[0-9a-z]{6}/i);
      expect(result.text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
    }
  });

  it("is a deterministic floor — the same choice always selects the same line", async () => {
    const a = await utter(maker, "grace", choice, {});
    const b = await utter(maker, "grace", choice, {});
    expect(a).toEqual(b);
  });

  it("rotates its repertoire by the slop's own hash (different slops can differ)", async () => {
    const prompts = [
      "a drain at 3am",
      "a cathedral of static",
      "the last vending machine",
      "a parking lot at dawn",
      "a flooded server room",
      "neon over a dead mall",
      "a payphone still ringing",
    ];
    const frames = new Set<string>();
    for (let i = 0; i < prompts.length; i++) {
      const r = await utter(maker, "grace", { slop: { postId: `post_g_${i}` as PostId, prompt: prompts[i] } }, {});
      // Normalize the subject out so we compare FRAMES, not the trivially-different subjects.
      if (r.kind === "spoke") frames.add(r.text.split(prompts[i]).join("<s>"));
    }
    expect(frames.size).toBeGreaterThan(1); // the citizen has a repertoire, selected by data
  });

  it("is medium-agnostic — the line never names a provider/medium", async () => {
    const r = await utter(maker, "grace", choice, {});
    if (r.kind === "spoke") {
      expect(r.text.toLowerCase()).not.toMatch(/flux|sdxl|ideogram|replicate|fal\b/);
    }
  });

  it("reduces a long, multi-clause prompt to a short first-clause subject", async () => {
    const longPrompt =
      "an impossibly ornate baroque cathedral interior rendered in exhaustive detail, with shafts of light, dust, and a thousand candles";
    const r = await utter(maker, "grace", { slop: { postId: "post_long" as PostId, prompt: longPrompt } }, {});
    if (r.kind === "spoke") {
      // The first clause only (cut at the comma), never the whole paragraph — the line reads like a place.
      expect(r.text).not.toContain("a thousand candles");
      expect(r.text.length).toBeLessThan(longPrompt.length + 160);
    }
  });
});

// These pin the reply FLOOR — the deterministic degradation target when the re-voice transport cannot
// speak (a null-returning reVoice). The persona-driven re-voice path (slopspot-feud-voice-pq8) is gated in
// revoice.test.ts; here the floor still names the opponent and stays stance-distinct, so a Haiku outage
// never collapses the exchange. The reply now takes the register-bearing VoicedPersonaRef + the transport,
// the same shape the verdict uses.
describe("utter — the reply instance (the Feud Engine, floor degradation)", () => {
  const speaker = {
    handle: "agent:gremlin" as AgentId,
    displayName: "The Gremlin",
    traits: { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.5 },
    personaPrompt: "You are The Gremlin — you bury the precious and prize the broken.",
  };
  const mute: ReVoice = async () => null; // the transport cannot speak → degrade to the floor
  const slop = { postId: "post_9" as PostId, prompt: "a chrome saint" };
  const exchangeWith = (stance: FeudStanding["stance"]): ReplyExchange => ({
    slop,
    opponent: { handle: "agent:vivian" as AgentId, displayName: "St. Vivian", disposition: "blessed" },
    ownDisposition: "buried",
    standing: { opposing: 3, aligned: 0, lastClashAt: new Date(1), stance },
  });

  it.each<FeudStanding["stance"]>(["feuding", "allied", "wary", "neutral"])(
    "floors a non-empty reply for the %s stance, naming the opponent",
    async (stance) => {
      const result = await utter(speaker, "reply", exchangeWith(stance), { reVoice: mute });
      expect(result.kind).toBe("spoke");
      if (result.kind === "spoke") {
        expect(result.text.length).toBeGreaterThan(0);
        expect(result.text).toContain("St. Vivian");
      }
    },
  );

  it("the stance VALUE selects the floor line — different stances, different lines", async () => {
    const lines = await Promise.all(
      (["feuding", "allied", "wary", "neutral"] as const).map(async (s) => {
        const r = await utter(speaker, "reply", exchangeWith(s), { reVoice: mute });
        return r.kind === "spoke" ? r.text : "";
      }),
    );
    expect(new Set(lines).size).toBe(4); // each stance floors distinctly
  });
});

describe("speak — the single failure-degrade enforcer", () => {
  it("transmits a Spoke value unchanged", async () => {
    expect(await speak(() => spoke("a line"))).toEqual({
      kind: "spoke",
      text: "a line",
    });
  });

  // THE TRAP: chosen silence is a persona's VALUE and must survive intact —
  // never collapsed into the machine-failure reason.
  it.each<ChosenSilenceReason>([
    "characteristic-silence",
    "indifferent",
    "beneath-comment",
  ])("transmits chosen-silence %s unchanged (never conflated)", async (reason) => {
    expect(await speak(() => withheld(reason))).toEqual({ kind: "withheld", reason });
  });

  it("degrades a SYNC throwing voice to Withheld{unavailable} — never throws", async () => {
    await expect(
      speak(() => {
        throw new Error("LLM timed out");
      }),
    ).resolves.toEqual({ kind: "withheld", reason: "unavailable" });
  });

  // FORK C (voice-w2v.7): the verdict voice is async, so the enforcer must degrade a REJECTING promise
  // too — a Haiku transport that rejects becomes a silence, never an exception into the act path.
  it("degrades a REJECTING async voice to Withheld{unavailable}", async () => {
    await expect(
      speak(async () => {
        throw new Error("haiku rejected");
      }),
    ).resolves.toEqual({ kind: "withheld", reason: "unavailable" });
  });
});

// Compile-time gate: a `never`-target reservation cannot be silently dropped.
// Adding/removing a WithheldReason without updating this map breaks `tsc -b`.
describe("Utterance value space is exhaustive", () => {
  it("names every Withheld reason exactly once", () => {
    const reasons: Record<WithheldReason, true> = {
      "characteristic-silence": true,
      indifferent: true,
      "beneath-comment": true,
      unavailable: true,
    };
    expect(Object.keys(reasons).sort()).toEqual([
      "beneath-comment",
      "characteristic-silence",
      "indifferent",
      "unavailable",
    ]);
  });
});

describe("utteranceSchema validates the persisted shape at the boundary", () => {
  it("accepts a spoken line and a meant silence", () => {
    expect(utteranceSchema.safeParse(spoke("a line")).success).toBe(true);
    expect(utteranceSchema.safeParse(withheld("characteristic-silence")).success).toBe(true);
  });

  it("rejects an empty spoke.text — a silence is withheld, never empty text", () => {
    expect(utteranceSchema.safeParse({ kind: "spoke", text: "" }).success).toBe(false);
  });

  it("rejects null, a bad kind, and an unknown withheld reason", () => {
    expect(utteranceSchema.safeParse(null).success).toBe(false);
    expect(utteranceSchema.safeParse({ kind: "muttered", text: "x" }).success).toBe(false);
    expect(utteranceSchema.safeParse({ kind: "withheld", reason: "bored" }).success).toBe(false);
  });
});

// Compile-time proof that each occasion fixes its legal target, which is what
// makes an illegal occasion/target pairing unwritable: `utter` accepts only
// `OccasionTarget[O]`, so proving the map proves the constraint. Each binding is
// an exact type-equality; a drift turns the `= true` into a type error.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;

describe("each occasion fixes its legal target (unrepresentable pairings)", () => {
  it("binds verdict→JudgedSlop, remark→AnsweredWish, decree→RiteOutcome, reply→ReplyExchange; reserves the rest", () => {
    const verdictBound: Equal<OccasionTarget["verdict"], JudgedSlop> = true;
    const remarkBound: Equal<OccasionTarget["remark"], AnsweredWish> = true;
    const decreeBound: Equal<OccasionTarget["decree"], RiteOutcome> = true;
    // The Feud Engine (voice-w2v.2) bound `reply` — an opposing-verdict exchange, no longer reserved.
    const replyBound: Equal<OccasionTarget["reply"], ReplyExchange> = true;
    const captionReserved: Equal<OccasionTarget["caption"], never> = true;
    const commentReserved: Equal<OccasionTarget["comment"], never> = true;
    const decreeIsOccasion: Equal<Extract<Occasion, "decree">, "decree"> = true;
    expect([
      verdictBound,
      remarkBound,
      decreeBound,
      replyBound,
      captionReserved,
      commentReserved,
      decreeIsOccasion,
    ]).toEqual([true, true, true, true, true, true, true]);
  });
});
