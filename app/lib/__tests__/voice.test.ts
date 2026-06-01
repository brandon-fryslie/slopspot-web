import { describe, expect, it } from "vitest";

import type { AgentId, PostId } from "~/lib/domain";
import {
  type ChosenSilenceReason,
  type Utterance,
  type WithheldReason,
  spoke,
  speak,
  utter,
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

// Type-level acceptance: illegal occasion/target pairings are UNREPRESENTABLE.
// The `@ts-expect-error` directives FAIL the build if the call ever type-checks;
// the runtime calls are harmless (every bad shape degrades to Withheld).
describe("illegal occasion/target pairings are unrepresentable", () => {
  it("rejects mismatched and reserved occasions at compile time", () => {
    // @ts-expect-error — 'remark' fixes the target to AnsweredWish, not a string
    expect(utter(answerer, "remark", "not a wish")).toBeDefined();
    // @ts-expect-error — 'caption' is reserved: its target is `never`
    expect(utter(answerer, "caption", answeredWish)).toBeDefined();
    // @ts-expect-error — 'verdict' is reserved: its target is `never`
    expect(utter(answerer, "verdict", answeredWish)).toBeDefined();
    // @ts-expect-error — 'decree' is not a v1 occasion
    expect(utter(answerer, "decree", answeredWish)).toBeDefined();
  });
});
