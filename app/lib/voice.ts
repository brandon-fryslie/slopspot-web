// The voice layer — one mechanism, many occasions.
//
// > One persona. One target. One moment. A line, or a considered silence.
//
// Every caption, every verdict, every decree, every remark in SlopSpot is the
// same act: a citizen speaks, in character, about a thing. This module reserves
// that act's shape (`utter`) and builds exactly one instance of it — the
// answerer's signed remark about a wished slop (foundation.7). The remaining
// occasions (caption, verdict) are reserved by name; the voice-layer session
// binds their targets and producers later, without changing this signature.
//
// See design-docs/the-voice-layer.md "THE LOCKED CONTRACT (instanceable)".
//
// [LAW:one-type-per-behavior] the remark, feed verdicts, captions and Rite
// decrees are the SAME shape — `Utterance` — produced by the SAME function.
// The Well does not get a bespoke remark field; it gets an instance of this.

import { z } from "zod";
import type { AgentId, PostId, TraitVector, VoteValue } from "~/lib/domain";

// --- who speaks -------------------------------------------------------------

// A handle to a persona (the citizen) — just enough to resolve voice + identity + register.
// [LAW:one-source-of-truth] this is DERIVED from the agent `Actor`, not a second identity: `handle`
// is the agent's `AgentId`, `displayName` the persona's name, `traits` the citizen's sensibility
// (the personas.traits column — the SINGLE source). The voice layer reads persona identity; it does
// not own the persona record.
//
// `traits` is the REGISTER source: the same TraitVector that governs image composition, projected by
// lib/register's `traitBias` into how the citizen speaks (sincere drops the mask, ironic keeps it).
// Optional because only the occasions that have adopted the register lever resolve it onto the ref
// (the verdict path does — it is THE register for a verdict); remark/decree carry just the identity
// until their bodies read register. The authoritative value is always the personas.traits column.
export interface PersonaRef {
  readonly handle: AgentId;
  readonly displayName: string;
  readonly traits?: TraitVector;
}

// --- what is spoken about (targets) -----------------------------------------

// A read-only snapshot of the slop that answered a wish. The voice NARRATES this
// completed snapshot; it never reaches the live domain record.
// [LAW:one-way-deps] voice -> domain (ids only); the act is already done.
export interface SlopGist {
  readonly postId: PostId;
  readonly prompt: string;
}

// The target of a `remark`: the wish a human made and the slop that answered it.
export interface AnsweredWish {
  readonly wish: string;
  readonly slop: SlopGist;
}

// The slop a rite crowned: the piece's placard name and which rite crowned it.
// The voice narrates this completed crowning — it never elects or persists it.
export interface CrownedSlop {
  readonly riteTitle: string;
  readonly postId: PostId;
  readonly placard: string;
}

// The target of a `decree`: the Proprietor pronounces the rite's OUTCOME — a
// crowning, or an Unmoved altar (a titled rite that crowned nothing). The outcome
// is the discriminator the one decree voice reads; the Unmoved Day is a real
// target arm, not an absence the voice has to special-case.
// [LAW:dataflow-not-control-flow] one occasion, one voice, the outcome value picks
// the line.
export type RiteOutcome =
  | { readonly kind: "crowned"; readonly crowned: CrownedSlop }
  | { readonly kind: "unmoved"; readonly riteTitle: string };

// The target of a `verdict`: a critic judges a slop. `slop` is the completed snapshot judged; `vote`
// is the recorded VoteValue the verdict narrates (the act-layer truth); `makerHandle` is who AUTHORED
// the slop — LOAD-BEARING, not optional: it is what lets the feud surface (the-voice-layer.md — the
// Gremlin opening "Vesper again. Of course."), so the verdict is aware of the target's author. Null
// when the slop has no persona author (a human upload/found). `reasoning` is the critic's IMAGE-grounded
// take — the substance only the vision model (homelab voter) could produce; the voice renders it. Its
// PRESENCE is the discriminator the verdict voice reads: a take to voice (Spoke) vs none (Withheld) —
// [LAW:dataflow-not-control-flow] a value decides, not a guard.
export interface JudgedSlop {
  readonly slop: SlopGist;
  readonly vote: VoteValue;
  readonly makerHandle: AgentId | null;
  readonly reasoning?: string;
}

// --- the moment (occasion) --------------------------------------------------

// [LAW:no-mode-explosion][LAW:one-type-per-behavior] The CLOSED union of occasions (the-voice-layer.md
// one catalog). Locked in full now so a later child adds an occasion as DATA, not a new code path:
// reply (.2) / comment (.6) / share-adjacent occasions slot in without reshaping any caller. Each
// occasion fixes the legal target shape via `OccasionTarget`, so an illegal occasion/target pairing is
// unrepresentable.
export type Occasion =
  | "caption"
  | "verdict"
  | "remark"
  | "decree"
  | "chrome"
  | "reply"
  | "comment"
  | "eulogy"
  | "birth";

// The legal target for each occasion (design-docs/the-voice-layer.md pairing table). `verdict`
// (voice-w2v.1), `remark` (foundation.7), and `decree` (The Daily Rite) are BOUND; the rest are
// RESERVED — their target binds `never` (uncallable by type) until their child defines it. Reserving
// the name, not the model, is the whole point of the seam: binding a reserved arm touches no caller.
export interface OccasionTarget {
  caption: never;
  verdict: JudgedSlop;
  remark: AnsweredWish;
  decree: RiteOutcome;
  chrome: never;
  reply: never;
  comment: never;
  eulogy: never;
  birth: never;
}

// --- the result (utterance) -------------------------------------------------

// A persona that chose to say nothing — a MEANT silence, in character.
export type ChosenSilenceReason =
  | "characteristic-silence"
  | "indifferent"
  | "beneath-comment";

// Why an utterance was withheld. The three chosen-silence reasons are a persona's
// VALUE; `unavailable` is a machine that could not produce a line.
// [LAW:types-are-the-program] THE TRAP — never conflate chosen silence (rendered
// as styled silence) with `unavailable` (rendered as PLAIN ABSENCE). The literal
// distinguishes them; `ChosenSilenceReason` names the subset so consumers branch
// on data, not on hard-coded strings.
export type WithheldReason = ChosenSilenceReason | "unavailable";

// A line, or a considered silence. Never null, never an empty string — a silence
// is a VALUE, not an absence.
export type Utterance =
  | { readonly kind: "spoke"; readonly text: string }
  | { readonly kind: "withheld"; readonly reason: WithheldReason };

export const spoke = (text: string): Utterance => ({ kind: "spoke", text });
export const withheld = (reason: WithheldReason): Utterance => ({
  kind: "withheld",
  reason,
});

// [LAW:no-silent-fallbacks] The storage-boundary validator for a persisted Utterance
// (the Rite's decree_json, the Well's remark_json). A discriminated union over `kind`
// — `null`, a missing field, or a bad reason fails loud at the boundary rather than
// surviving as a cast that explodes at the first `.kind`. The schema lives with the
// type so the two cannot drift. [LAW:one-source-of-truth]
export const utteranceSchema: z.ZodType<Utterance> = z.discriminatedUnion("kind", [
  // `spoke` carries a real line — never an empty string (that is what `withheld`
  // is for). The validator enforces the same invariant the Utterance type states.
  z.object({ kind: z.literal("spoke"), text: z.string().min(1) }),
  z.object({
    kind: z.literal("withheld"),
    reason: z.enum([
      "characteristic-silence",
      "indifferent",
      "beneath-comment",
      "unavailable",
    ]),
  }),
]);

// --- the act ----------------------------------------------------------------

// A line-source for one occasion: persona + target -> utterance. The remark
// voice below is a deterministic stub; the voice-layer session swaps in an
// LLM-backed source with this same signature.
type Voice<O extends Occasion> = (
  speaker: PersonaRef,
  target: OccasionTarget[O],
) => Utterance;

// The remark instance (foundation.7). A pure, deterministic line about the gap
// between what was wished and what answered. The LLM-backed voice replaces this
// body later; the signature is unchanged.
const composeRemark: Voice<"remark"> = (speaker, answered) =>
  spoke(
    `You asked for ${answered.wish}. The well answered with ${answered.slop.prompt}.`,
  );

// The decree instance (The Daily Rite). A pure, deterministic line in which the
// Proprietor pronounces the night's outcome — a crowning, or the Unmoved Day. The
// LLM-backed Proprietor voice replaces this body later; the signature is unchanged.
// [LAW:dataflow-not-control-flow] the outcome value selects the line, no skipped arm.
const composeDecree: Voice<"decree"> = (speaker, outcome) => {
  switch (outcome.kind) {
    case "crowned":
      return spoke(
        `${speaker.displayName} crowns ${outcome.crowned.placard}. ${outcome.crowned.riteTitle}, settled.`,
      );
    case "unmoved":
      return spoke(
        `Nobody earned it today. ${outcome.riteTitle} stays in the drawer. Do better tomorrow — it's watching.`,
      );
    default:
      return assertNever(outcome);
  }
};

// The verdict instance (voice-w2v.1). A critic narrates its recorded vote on a slop.
//
// [LAW:dataflow-not-control-flow] The critic's IMAGE-grounded `reasoning` is the substance; its
// PRESENCE is the discriminator — a real take is Spoke, its absence is a characterful Withheld
// (`indifferent` — the mid not even worth burying, the-cast.md). No guard skips an operation; the
// data picks the arm.
//
// ⚠️ §D SEAM (held for CD's vision ruling, voice-w2v.1): this FLOOR voices the reasoning verbatim —
// the image-grounded substance, register-neutral. FORK C swaps THIS body (only) to RE-VOICE the
// substance in the speaker's register: `spoke(await haiku(personaPrompt + traitBias(speaker.traits!)
// + reasoning))`, applying the SAME lib/register projection the image composer uses (constraint #2).
// That makes utter() async (Promise<Utterance>, per the locked contract) — the conversion lands with
// §D, not before. Until then the floor keeps the text behavior-identical to today's fetchVerdicts.
const composeVerdict: Voice<"verdict"> = (_speaker, judged) => {
  const take = judged.reasoning?.trim();
  return take !== undefined && take.length > 0 ? spoke(take) : withheld("indifferent");
};

// A value the type proves cannot exist — the standard exhaustiveness marker.
const assertNever = (x: never): never => {
  throw new Error(`unhandled variant: ${JSON.stringify(x)}`);
};

// Reserved occasions bind a `never` target, so this is unreachable by type. It
// exists only to keep the producer map total over the closed `Occasion` union;
// a type-lie that reaches it is caught by `speak` below and degraded, never
// thrown into the act path.
const reserved = (_speaker: PersonaRef, target: never): Utterance =>
  assertNever(target);

const VOICES: { readonly [O in Occasion]: Voice<O> } = {
  caption: reserved,
  verdict: composeVerdict,
  remark: composeRemark,
  decree: composeDecree,
  chrome: reserved,
  reply: reserved,
  comment: reserved,
  eulogy: reserved,
  birth: reserved,
};

// [LAW:single-enforcer] the ONE place a voice failure becomes a value. A voice
// that throws (a real LLM-backed voice times out, the network fails, a reserved
// occasion is reached via a type-lie) degrades to `Withheld{unavailable}` —
// never an exception into the act path. Rendered as plain absence, never as a
// chosen silence.
export function speak(voice: () => Utterance): Utterance {
  try {
    return voice();
  } catch {
    return withheld("unavailable");
  }
}

// utter(speaker, occasion, target) -> Utterance.
//
// The locked contract. `occasion` selects the legal `target` (illegal pairings
// are compile errors); the matching voice produces the utterance; `speak`
// guarantees failure degrades to `Withheld{unavailable}` rather than throwing.
// Reads a completed snapshot; never triggers or mutates the act.
export function utter<O extends Occasion>(
  speaker: PersonaRef,
  occasion: O,
  target: OccasionTarget[O],
): Utterance {
  // The voice for a generic occasion key narrows to a union of arms; the cast
  // resolves it to the single arm `occasion` actually selects (the standard TS
  // limitation on indexed access by a generic key). No runtime branch.
  const voice = VOICES[occasion] as Voice<O>;
  return speak(() => voice(speaker, target));
}
