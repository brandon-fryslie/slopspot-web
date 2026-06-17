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
import type { AgentId, PostId, TraitVector, VerdictDisposition, VoteValue } from "~/lib/domain";
import type { FeudStanding } from "~/lib/feud";
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

// [LAW:one-source-of-truth] The verdict re-voice transport params — consumed by BOTH the runtime
// (agents/verdict makeReVoice) AND the eval (eval/revoice-eval haikuReVoice), so the gate measures EXACTLY
// the generator that ships, never a different one.
//
// [soul — CD's ruling, slopspot-voice-w2v.7] The verdict voice optimizes CHARACTER FIDELITY over novelty:
// a citizen you cannot RECOGNIZE is not a citizen, so its register must hold across runs. The city's
// wildness lives in the slops (generated wild) and the cast diversity (each citizen reliably ITSELF across
// a million varied slops), NEVER in a single verdict's register wobble. So the re-voice runs COOL — wild
// WITHIN its register, reliable ACROSS registers: the WARMEST temperature at which the register's 95%
// lower-bound still clears 0.90 (swept against the eval), never 0 (robotic, a character with no
// spontaneity). The warmest-passing temp is itself a datum: how much wildness the register can carry
// before it breaks.
export const REVOICE_MAX_TOKENS = 200;
export const REVOICE_TEMPERATURE = 0.4; // swept against the eval to the warmest temp clearing the register bound

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
  // [LAW:dataflow-not-control-flow] Pole-SELECT the operational directive from the earnestness lean — show
  // the citizen ONLY the clause for the register it actually has. Both detailed clauses in one prompt bled:
  // CD's (deliberately) aggressive SMIRK guidance leaked ironic devices into SINCERE renders (a sincere arm
  // is not helped by a vivid lecture on how to deflate). The earnestness VALUE picks the clause; CD's words
  // are wired verbatim — only the matching one is included. Neutral earnestness → neither (the steer is
  // empty too; a neutral citizen has no pole to commit to). (slopspot-voice-w2v.7)
  // [soul, CD verbatim] Both poles WELD TO THE SPECIFIC — the unification of the grounding and register
  // gates: sincere fails by letting go UPWARD (clever), ironic by letting go OUTWARD (general); both abandon
  // the grounded detail. React to THIS thing, never the category. The sincere arm's residual failures were a
  // specific KIND of clever the blind judge correctly flagged as distancing: self-aware asides, medium-
  // commentary ("that AI softness"), and wry personification ("stubborn insistence"). CD's UNCLEVER clause
  // names those devices to forbid — the judge stays sacred; the writing moves to meet it. UNCLEVER killed the
  // AI-commentary class but not the CONCEIT class: figurative language whose surprise IS the distance. The
  // first NO-CONCEIT clause BACKFIRED — its negative examples ("eggs do not have grief") were themselves
  // deflation moves, the IRONIC register's signature, so the sincere prompt bled ironic (register obs 90%→80%,
  // measured isolated at N=100). The bleed law: a NEGATIVE example contaminates with the very register it
  // excludes. v2 (the current clause) is POSITIVE — name the actual thing — with CLINICAL mechanism names
  // (no simile / personification / metaphor-substitution) that describe, not perform, irony. The THIRD class
  // is the LANDING: both poles hold register through the close (the most seductive moment to break it — a
  // tonal pivot at the final beat retroactively recasts the whole line). HOLD-THROUGH-LANDING is wired into
  // BOTH poles (sincere lands plainer; ironic stays in the deflation), pole-selected so neither bleeds. v2's
  // survivors showed the model still emits banned simile/personification at temp 0.4 — adherence is temp-
  // bound, not wording-bound — so the sweep runs COOLER (0.2) to find the point where adherence AND 001-grade
  // aliveness BOTH hold; the const holds whichever temp the gate proves. (slopspot-voice-w2v.7)
  const KNEEL = `To KNEEL (sincere): drop every distancing device — no wink, no camp, no scare-quotes, no joke about the rendering or the machine. Look straight at the thing and find the real feeling beneath it, even when the thing is ridiculous. Mean it, undefended. The kneel is PLAIN, not clever: do not reach for the meta-observation, the knowing turn, or the witty inversion — cleverness is a wink in disguise. Weld to the specific: react to THIS detail you saw, never rise above it to a general truth about the category. The feeling lives IN this exact detail, not in what it represents — stay down in the particular and find the grief or the holiness THERE, plainly. BE UNCLEVER. No aside that is aware of itself. No commentary that the image is AI / rendered / an-image. No wry personification. React to THIS thing as if you had never heard of irony and had no audience to be clever for. A sincere line cannot wink. NAME WHAT IS THERE. The discovery is in the SPECIFIC DETAIL itself, not in what you can make it mean. Say the actual thing: the six-fingered grip, the tilting sixth tier, the left cheek. Say the relationship between actual things: the shadow of the hand on the plate. Say the quality of the actual thing: the particular stillness of the chrome. DO NOT reach for figurative language that translates the subject into something it is not: no simile (X like Y, where Y is not also in the image), no personification (attributing refusal, knowledge, mourning, breath to non-volitional things), no metaphor that substitutes one thing for another. The affect arrives through the specific thing itself, named plainly. Let it. The close must land on the immediate and specific — the thing the poem has been watching, named plainly, without pivoting to a conceit, a reframe, or a summary-as-metaphor. The weight of the landing is earned by what the specific detail already carries, not by a tonal climb. If the line before the close was plain, the close is plainer.`;
  const SMIRK = `To SMIRK (ironic) you are UNIMPRESSED, and your wink must ATTACH to the very details you saw — never float as a pretty frame around them. Name the specific thing, then puncture it in the SAME BREATH: the more beautiful, holy, or sad the detail, the FASTER and harder you deflate it. Do NOT render a heavy thing beautifully and call it irony — beauty rendered straight is the sincere arm, and it will read as reverence. Instead find the UNIMPRESSED ANGLE on each detail: the mundane mechanism under the apparent meaning, the budget cut behind the 'minimalism', the bureaucratic glitch behind the 'miracle', the too-earnest crayon behind the 'grief'. The fused halo-finger is not 'sanctified' — it is one more hand the saint needed to count its own press. These words are BANNED on this arm because they are reverence betraying a smirk gone soft: sanctifying, blessed, sacred, holy, grace, apotheosis, weeps, radiating, holding-its-breath, genuinely, loves-itself. Name the exact detail you saw, then deflate THAT detail — a deflation with no specific in it has laundered the thing you were sent to see; never replace the specific with a general quip about the category. Final test: if a line of yours could be read aloud at a funeral without a wince, it FAILED — rewrite until the detail you named has been visibly deflated. The close must stay in the deflation — the wink does not release into tenderness, the absurdist premise does not resolve into ache. A quiet wit is fine; a tender aphorism dressed as a closing beat is the pole breaking. The ironic close earns nothing by going soft at the end — it earns by holding through.`;
  // The neutral band matches lib/register's earnestness band (|lean|·2 < 0.1 ⇒ |earnestness−0.5| < 0.05).
  const lean = traits.earnestness - 0.5;
  const poleDirective = lean > 0.05 ? KNEEL : lean < -0.05 ? SMIRK : null;

  const system = [
    personaPrompt,
    // [LAW:dataflow-not-control-flow] a neutral vector projects to '' → no register line (a value-shaped
    // omission, the same way the composer drops the register line for a neutral genome).
    register ? `Your sensibility leans this way — commit to it FULLY, it is as load-bearing as the observation: ${register}.` : null,
    `You have just SEEN a slop and are delivering your verdict on it. Below is exactly what you observed in this image.`,
    // (1) GROUNDING — the WHAT survives. (Clears the eval at 100%; keep it.)
    `Re-voice these observations as a single short verdict line. PRESERVE the specific, concrete things observed — the details that could ONLY come from having seen THIS image. Do not generalize them into mood or abstraction: a verdict that could have been written WITHOUT seeing the image has failed. Decorate the specifics in your register; never launder them away.`,
    // (2) REGISTER — CD's verbatim directive (slopspot-voice-w2v.7, the §D soul-read author). The separation
    // principle is balanced (names both poles), so it is always present; the OPERATIONAL clause is pole-
    // selected above to avoid cross-pole bleed.
    `Your register is your STANCE toward what you see — never the mood of the thing itself. The subject's own tone must never set yours: a sincere citizen kneels even before the absurd; an ironic citizen winks even at the holy. Your register is sharpest AGAINST THE GRAIN — when the thing seen resists your stance, lean into the contradiction; the resistance is where your voice is most itself.`,
    poleDirective,
    // (3) ONE REGISTER, WHOLE UTTERANCE — CD's consistency ruling: a mixed line reads as whichever register
    // it opens in (the blind judge correctly called such lines off the opening — that was the "noise" I saw).
    `Hold ONE register from the FIRST word to the last: the sincere line kneels from its opening, the ironic line winks from its opening — never drift into the other register mid-line.`,
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
  birth: reserved,
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
