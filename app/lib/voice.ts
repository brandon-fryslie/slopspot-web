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
import type { AgentId, PostId, ProviderId, TraitVector, VerdictDisposition, VoteValue } from "~/lib/domain";
import type { FeudStanding } from "~/lib/feud";
import { seedHash } from "~/lib/hash";
import { traitBias } from "~/lib/register";

// --- who speaks -------------------------------------------------------------

// A handle to a persona (the citizen) — just enough to resolve voice + identity + register.
// [LAW:one-source-of-truth] this is DERIVED from the agent `Actor`, not a second identity: `handle`
// is the agent's `AgentId`, `displayName` the persona's name, `traits` the citizen's sensibility
// (the personas.traits column — the SINGLE source). The voice layer reads persona identity; it does
// not own the persona record.
//
// `traits` is the REGISTER source: the same TraitVector that governs image composition, projected by
// lib/register's `traitBias` into how the citizen speaks (sincere drops the mask, ironic keeps it).
// `personaPrompt` is the citizen's authoring voice (the private character bible the composer steers
// with). Both are optional on the BASE ref because not every occasion re-voices; the occasions that do
// require the register-bearing `VoicedPersonaRef` below, which makes them non-optional. The
// authoritative values are always the personas.traits / personas.persona_prompt columns.
export interface PersonaRef {
  readonly handle: AgentId;
  readonly displayName: string;
  readonly traits?: TraitVector;
  readonly personaPrompt?: string;
}

// [LAW:types-are-the-program] The register-bearing speaker — REQUIRED traits + personaPrompt, for the
// occasions whose voice re-voices substance in the citizen's register (the verdict, FORK C). A verdict is
// narrated only for a resolved agent-persona that HAS both, so the type encodes that: `composeVerdict`
// reads `speaker.personaPrompt` / `speaker.traits` with no presence-guard, because the type forbids a
// verdict speaker that lacks them. (slopspot-voice-w2v.7)
export interface VoicedPersonaRef extends PersonaRef {
  readonly traits: TraitVector;
  readonly personaPrompt: string;
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

// The citizen a reply ANSWERS — the incumbent whose verdict opposes the speaker's on the same slop.
// `disposition` is their lean (the gilt blessing vs the burial robe); `displayName` is the byline the
// speaker addresses. This is the cross-reference that makes the city a society with grudges, not a set
// of isolated captions (the-voice-layer.md — the Gremlin's "Vesper again. Of course.").
export interface FeudOpponent {
  readonly handle: AgentId;
  readonly displayName: string;
  readonly disposition: VerdictDisposition;
}

// The target of a `reply`: one citizen answers another's OPPOSING verdict on the same slop. `standing`
// is the DERIVED relationship between the two citizens (app/db/feud — read from their shared vote
// history, never stored), and its `stance` is the TONE source — a feud runs barbed, allies disagreeing
// is a shock, the wary stay guarded. [LAW:dataflow-not-control-flow] the stance VALUE selects the reply
// register; the reply is not a new code path but an occasion the opposing-verdict data fires.
export interface ReplyExchange {
  readonly slop: SlopGist;
  readonly opponent: FeudOpponent;
  readonly ownDisposition: VerdictDisposition;
  readonly standing: FeudStanding;
}

// The target of a `birth`: the new citizen the Proprietor welcomes into the city (The Birth Rite,
// slopspot-growing-cast-7ni.3). The voice NARRATES a birth that ALREADY happened — the midwife writes the
// persona row first, THEN the Proprietor announces it; this snapshot never creates the citizen.
// [LAW:one-way-deps] voice -> persona identity (the name to announce + the creed that gives the welcome
// its substance), never the live persona row. Both are non-optional: a newborn always has a name and a
// creed (the midwife authors both), so the welcome line reads them with no presence-guard.
export interface Newcomer {
  readonly displayName: string;
  readonly creed: string;
  // The newcomer's medium (its provider id) — an honest attribute of the citizen, carried so the
  // announcement path can DERIVE a first-of-medium distinction later (poj.4: the first verse-citizen is
  // decreed "the city's first poet") without reshaping this target. composeBirth is medium-agnostic
  // today; the field is the citizen's real medium, not speculative scaffolding. [LAW:one-source-of-truth]
  readonly medium: ProviderId;
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
// (voice-w2v.1), `remark` (foundation.7), `decree` (The Daily Rite), and `reply` (the Feud Engine,
// voice-w2v.2) are BOUND; the rest are RESERVED — their target binds `never` (uncallable by type) until
// their child defines it. Reserving the name, not the model, is the whole point of the seam: binding a
// reserved arm — as `reply` does here — touches no existing caller.
export interface OccasionTarget {
  caption: never;
  verdict: JudgedSlop;
  remark: AnsweredWish;
  decree: RiteOutcome;
  chrome: never;
  reply: ReplyExchange;
  comment: never;
  eulogy: never;
  birth: Newcomer;
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

// [LAW:one-way-deps][capabilities-over-context] The re-voice TRANSPORT, injected. voice.ts is a pure
// lib leaf — it must not reach env or the Anthropic API. The agent layer (which holds env) binds a
// `ReVoice` over the shared callHaiku leaf and hands it in via `caps`. This grants the ONE specific
// ability the verdict voice needs (turn a prompt into a line), never the omniscient env. A `null` return
// means the transport could not produce a line (no key, timeout, failure) — the voice degrades to its
// verbatim floor, never silence. (slopspot-voice-w2v.7)
export interface ReVoicePrompt {
  readonly system: string;
  readonly user: string;
}
export type ReVoice = (prompt: ReVoicePrompt) => Promise<string | null>;

// [LAW:types-are-the-program] The speaker shape PER occasion: the verdict re-voices, so its speaker is
// the register-bearing `VoicedPersonaRef` (traits + personaPrompt required); every other occasion takes
// the base ref. Calling utter('verdict', …) with a speaker that lacks the register is a COMPILE error,
// not a runtime guard.
type SpeakerFor<O extends Occasion> = O extends "verdict" ? VoicedPersonaRef : PersonaRef;

// [LAW:types-are-the-program] The capabilities PER occasion: the verdict REQUIRES the reVoice transport;
// every other occasion takes none (the empty object). So the type forces the verdict caller to inject the
// transport AND frees the sync callers (decree/remark) from constructing one they would never use —
// CapsFor is what makes the injection land at exactly the right callers, no more.
type CapsFor<O extends Occasion> = O extends "verdict"
  ? { readonly reVoice: ReVoice }
  : Record<string, never>;

// A line-source for one occasion: persona + target + caps -> utterance (sync floors) or a Promise (the
// LLM-backed verdict). `speak` awaits either, so a voice may be sync or async at will.
type Voice<O extends Occasion> = (
  speaker: SpeakerFor<O>,
  target: OccasionTarget[O],
  caps: CapsFor<O>,
) => Utterance | Promise<Utterance>;

// The remark instance (foundation.7). A pure, deterministic line about the gap
// between what was wished and what answered. The LLM-backed voice replaces this
// body later; the signature is unchanged.
// [LAW:single-enforcer][LAW:one-source-of-truth] The deterministic remark line, as a PURE sync function
// returning Utterance. It is the ONE source of the remark text, with two consumers at two timings: the
// act path records it through `utter('remark', …)` (async-wrapped like every act); the post-card renders
// it SYNCHRONOUSLY at read time (a React render cannot await the now-async utter, and the card is not
// enacting the remark — it is re-rendering a deterministic floor). Exposed sync so the render path needs
// no await and no second copy of the line. (The eventual fix reads the persisted remark_json at the
// generation read boundary; until that is wired, both paths share THIS function.)
export function remarkFloor(speaker: PersonaRef, answered: AnsweredWish): Utterance {
  return spoke(`You asked for ${answered.wish}. The well answered with ${answered.slop.prompt}.`);
}
const composeRemark: Voice<"remark"> = remarkFloor;

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

// [LAW:dataflow-not-control-flow][LAW:one-type-per-behavior] The Proprietor's REPERTOIRE of welcome
// frames — the host has more than one way to open the door. Each frame names the speaker + the newcomer
// and wraps the newcomer's ALWAYS-VARYING creed (the personal core); the signature refrain "Mind the
// relics" RECURS across several (a host has a catchphrase). The frame is selected by DATA (the birth's
// own hash), never a branch and never an LLM — so this stays a pure deterministic floor.
const BIRTH_FRAMES: ReadonlyArray<(host: string, newcomer: string, creed: string) => string> = [
  (host, newcomer, creed) =>
    `${host} welcomes ${newcomer} to the city. "${creed}" — another devout pair of hands. Mind the relics.`,
  (host, newcomer, creed) =>
    `${host} unlatches the back door for ${newcomer}, who swears "${creed}". The city is one soul larger.`,
  (host, newcomer, creed) =>
    `New blood. ${host} seats ${newcomer} at the long table; their creed runs "${creed}". Mind the relics.`,
  (host, newcomer, creed) =>
    `${host} rings the bell for ${newcomer}. "${creed}", they say — and for now the city believes them.`,
  (host, newcomer, creed) =>
    `Make room: ${newcomer} has arrived, preaching "${creed}". ${host} nods them in. Mind the relics.`,
];

// The birth instance (The Birth Rite, slopspot-growing-cast-7ni.3). The Proprietor welcomes a newborn
// citizen — a daily rite in the city's liturgy. A pure, deterministic floor that NAMES the newcomer in
// the Proprietor's register (the host's deadpan welcome — reverent about garbage, proprietorial about the
// relics) and rotates through his repertoire by the birth's own hash; the LLM-backed Proprietor voice can
// replace this body later, the signature unchanged.
// [LAW:dataflow-not-control-flow] the newcomer VALUE selects the frame (seedHash over its name — the same
// reproducible hash the chooser/scheduler use, so the welcome is deterministic + stable on re-render) AND
// supplies the line; birth never branches on "did a birth happen": the caller utters ONLY for a real
// birth (gated on createPersona's `created`). [LAW:one-source-of-truth] reuses lib/hash, no second FNV-1a.
const composeBirth: Voice<"birth"> = (speaker, newcomer) => {
  const frame = BIRTH_FRAMES[seedHash(0, newcomer.displayName) % BIRTH_FRAMES.length]!;
  return spoke(frame(speaker.displayName, newcomer.displayName, newcomer.creed));
};

// [LAW:single-enforcer] The verdict re-voice PROMPT — built in ONE pure place so CI can prove its
// shape deterministically (the grounding seam). SUBSTANCE is the critic's image-grounded observation
// (`reasoning`); REGISTER is traitBias(traits) — the SAME lib/register projection the image composer
// embeds (one vector, two consumers). The directive is the crux of FORK C's gate: re-voice DECORATES the
// specific observations in the citizen's register; it must PRESERVE the this-slop-only specifics, never
// launder them into blind-writable mush. (slopspot-voice-w2v.7)
export function buildReVoicePrompt(
  personaPrompt: string,
  traits: TraitVector,
  reasoning: string,
): ReVoicePrompt {
  const register = traitBias(traits);
  const system = [
    personaPrompt,
    // [LAW:dataflow-not-control-flow] a neutral vector projects to '' → no register line (a value-shaped
    // omission, the same way the composer drops the register line for a neutral genome).
    register ? `Speak in this register: ${register}.` : null,
    `You have just SEEN a slop and are delivering your verdict on it. Below is exactly what you observed in this image.`,
    `Re-voice these observations as a single short verdict line in your own register. PRESERVE the specific, concrete things observed — the details that could ONLY come from having seen THIS image. Do not generalize them into mood or abstraction: a verdict that could have been written WITHOUT seeing the image has failed. Decorate the specifics in your register; never launder them away.`,
    `Reply with ONLY the verdict line — no preamble, no quotation marks, no explanation.`,
  ]
    .filter(Boolean)
    .join(" ");
  return { system, user: reasoning };
}

// The verdict instance (voice-w2v.1 floor → FORK C re-voice, voice-w2v.7). A critic narrates its
// recorded vote on a slop.
//
// [LAW:dataflow-not-control-flow] The critic's IMAGE-grounded `reasoning` is the substance; its PRESENCE
// is the discriminator — a real take is Spoke, its absence a characterful Withheld (`indifferent` — the
// mid not even worth burying, the-cast.md). No guard skips an operation; the data picks the arm.
//
// FORK C: the substance is RE-VOICED in the speaker's register via the injected reVoice transport. The
// speaker is a VoicedPersonaRef (traits + personaPrompt REQUIRED by the type — no presence-guard), and
// caps.reVoice is REQUIRED for the verdict occasion. [LAW:dataflow-not-control-flow] on a transport that
// cannot speak (null — no key/timeout/failure) the value degrades to the verbatim FLOOR (`?? take`),
// behavior-identical to w2v.1; the grounding is trivially preserved because the verbatim reasoning IS the
// grounded observation. The register only renders when the LLM body answers.
const composeVerdict: Voice<"verdict"> = async (speaker, judged, caps) => {
  const take = judged.reasoning?.trim();
  return take === undefined || take.length === 0
    ? withheld("indifferent")
    : spoke((await caps.reVoice(buildReVoicePrompt(speaker.personaPrompt, speaker.traits, take))) ?? take);
};

// The disposition's verbs — the city's words for the two ways to judge. A total map over the closed
// VerdictDisposition, so a third disposition breaks the reply lines at compile time.
const DISPOSITION_VERB: Record<VerdictDisposition, { present: string; past: string }> = {
  blessed: { present: "bless", past: "blessed" },
  buried: { present: "bury", past: "buried" },
};

// The reply instance (the Feud Engine, voice-w2v.2). One citizen answers another's OPPOSING verdict, and
// the tone is the DERIVED standing's stance — not a stored mood, the read of their shared history.
//
// [LAW:dataflow-not-control-flow] the stance VALUE selects the line via a total map over the closed
// FeudStance union; a fifth stance breaks this literal at compile time. No `if (feuding)` chain — the
// data picks the register, the same way the decree's outcome picks its arm.
//
// ⚠️ §D SEAM (mirrors composeVerdict): this FLOOR voices a deterministic, register-neutral line. The
// LLM-backed Feud voice swaps THIS body (only) to author the answer in the speaker's register
// (personaPrompt + traitBias(speaker.traits) + the standing) — the signature is unchanged, the seam
// holds. Until then the floor proves the dataflow: opposing verdicts → a stance-tinted exchange.
const composeReply: Voice<"reply"> = (speaker, exchange) => {
  const them = exchange.opponent.displayName;
  const own = DISPOSITION_VERB[exchange.ownDisposition];
  const theirs = DISPOSITION_VERB[exchange.opponent.disposition];
  const line: Record<FeudStanding["stance"], string> = {
    // A standing grudge: barbed, the opponent named with weary contempt.
    feuding: `${them} again. Of course they ${theirs.past} it. I ${own.present} it — that's the whole point.`,
    // Allies splitting is the citywide shock the-city-talks.md promises.
    allied: `Even ${them} and I part ways here. I ${own.present} it; they ${theirs.past} it. Shocking.`,
    // An uneasy, complicated standing — guarded, no warmth offered.
    wary: `${them} ${theirs.present}s it; I ${own.present} it. We rarely line up, and today is no exception.`,
    // Strangers crossing for the first time — flat, sizing each other up.
    neutral: `${them} ${theirs.past} it. I ${own.present} it. First time we have crossed.`,
  };
  return spoke(line[exchange.standing.stance]);
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
  reply: composeReply,
  comment: reserved,
  eulogy: reserved,
  birth: composeBirth,
};

// [LAW:single-enforcer] the ONE place a voice failure becomes a value. A voice that throws OR rejects (a
// real LLM-backed voice times out, the network fails, a reserved occasion is reached via a type-lie)
// degrades to `Withheld{unavailable}` — never an exception into the act path. Rendered as plain absence,
// never as a chosen silence. `await` covers both sync floors and the async re-voice: awaiting a plain
// value is a no-op, awaiting a rejected promise routes into the catch.
export async function speak(voice: () => Utterance | Promise<Utterance>): Promise<Utterance> {
  try {
    return await voice();
  } catch {
    return withheld("unavailable");
  }
}

// utter(speaker, occasion, target, caps) -> Promise<Utterance>.
//
// The locked contract (async since FORK C). `occasion` selects the legal `target` AND the legal
// `speaker`/`caps` shapes (illegal pairings are compile errors — a verdict demands a VoicedPersonaRef +
// the reVoice transport; sync occasions take the empty caps); the matching voice produces the utterance;
// `speak` guarantees failure degrades to `Withheld{unavailable}` rather than throwing. Reads a completed
// snapshot; never triggers or mutates the act.
export function utter<O extends Occasion>(
  speaker: SpeakerFor<O>,
  occasion: O,
  target: OccasionTarget[O],
  caps: CapsFor<O>,
): Promise<Utterance> {
  // The voice for a generic occasion key narrows to a union of arms; the cast
  // resolves it to the single arm `occasion` actually selects (the standard TS
  // limitation on indexed access by a generic key). No runtime branch.
  const voice = VOICES[occasion] as Voice<O>;
  return speak(() => voice(speaker, target, caps));
}
