import { describe, expect, it } from "vitest";

import type { AgentId, PostId } from "~/lib/domain";
import {
  type AnsweredWish,
  type ChosenSilenceReason,
  type Occasion,
  type OccasionTarget,
  type RiteOutcome,
  type Utterance,
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
  it("speaks the remark instance: (answerer, 'remark', AnsweredWish) -> Spoke", () => {
    const result = utter(answerer, "remark", answeredWish);
    expect(result.kind).toBe("spoke");
    if (result.kind === "spoke") {
      // narrates the gap between wish and slop — never an empty string
      expect(result.text).toContain("a sunset");
      expect(result.text.length).toBeGreaterThan(0);
    }
  });

  it("reads the snapshot without mutating it (one-way dep voice -> domain)", () => {
    const frozen = Object.freeze({
      wish: "a sunset",
      slop: Object.freeze({
        postId: "post_1" as PostId,
        prompt: "a sunset over a dead mall",
      }),
    });
    expect(() => utter(answerer, "remark", frozen)).not.toThrow();
  });
});

describe("speak — the single failure-degrade enforcer", () => {
  it("transmits a Spoke value unchanged", () => {
    expect(speak(() => spoke("a line"))).toEqual({
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
  ])("transmits chosen-silence %s unchanged (never conflated)", (reason) => {
    expect(speak(() => withheld(reason))).toEqual({ kind: "withheld", reason });
  });

  it("degrades a throwing voice to Withheld{unavailable} — never throws", () => {
    let result: Utterance | undefined;
    expect(() => {
      result = speak(() => {
        throw new Error("LLM timed out");
      });
    }).not.toThrow();
    expect(result).toEqual({ kind: "withheld", reason: "unavailable" });
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
  it("binds remark→AnsweredWish and decree→RiteOutcome, reserves caption/verdict", () => {
    const remarkBound: Equal<OccasionTarget["remark"], AnsweredWish> = true;
    const decreeBound: Equal<OccasionTarget["decree"], RiteOutcome> = true;
    const captionReserved: Equal<OccasionTarget["caption"], never> = true;
    const verdictReserved: Equal<OccasionTarget["verdict"], never> = true;
    const decreeIsOccasion: Equal<Extract<Occasion, "decree">, "decree"> = true;
    expect([
      remarkBound,
      decreeBound,
      captionReserved,
      verdictReserved,
      decreeIsOccasion,
    ]).toEqual([true, true, true, true, true]);
  });
});
