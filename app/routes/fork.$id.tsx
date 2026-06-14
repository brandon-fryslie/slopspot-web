import type { Route } from "./+types/fork.$id"
import { useEffect, useRef, useState } from "react"
import { Link, useNavigate } from "react-router"
import { z } from "zod"
import { getPostById } from "~/db/feed"
import { realProviders } from "~/providers"
import { listPersonas } from "~/agents/persona"
import { PROMPT_MAX } from "~/lib/fork-bounds"
import {
  PostId,
  type AspectRatio,
  type RecipeSubject,
  type StyleFamily,
} from "~/lib/domain"
import { ASPECT_RATIOS, STYLE_FAMILIES, STYLE_FAMILY_PROMPT_SEEDS, renderTemplate } from "~/lib/variety"
import { REWRITE_DELIMITER } from "~/lib/rewrite-delim"
import { forkPause, type BreedPause } from "~/lib/breed-failure"

// [LAW:locality-or-seam] Page route only — loader + default export. The
// submit-side action lives at /api/fork/:id (a resource route), matching the
// shape of /api/posts/:id/vote and /api/posts/:id/comments. A page route
// with both a loader and an action triggers RR7's document-handler CSRF gate,
// which requires the host proxy to set x-forwarded-host — a header the
// vite-plugin dev server does not produce. The same-origin defense already
// lives at the resource route's HTTP boundary (~/lib/same-origin), so the
// split is no security regression.
//
// [LAW:types-are-the-program] Only Content.kind === 'generation' is forkable —
// uploads carry no recipe. The reader returns the closed Content union and
// the loader asserts the discriminator before reading recipe fields. The
// PostCard Fork button is gated on this discriminator at compile time, so
// upload posts can never produce a fork-button click; the 400 here defends
// direct-URL access.

// The form pre-fills the parent genome's UTTERANCE (a first-class field) and lets the user
// edit it; other provider-specific tunables (steps / negativePrompt / seed / styleType) are
// re-derived in the action via defaultParamsForRecipe, mirroring the firehose chooser's
// translation. PROMPT_MAX (from `~/lib/fork-bounds`, the shared client/server-safe module) is
// the union ceiling — wide enough for any parent's utterance; the per-provider tighter bound
// (provider.promptMaxLength) drives the form's maxLength + counter.

// [LAW:one-source-of-truth] The response contract from /api/fork/:id, pinned here at module
// scope — defined once per file load, not re-instantiated on every form submit. The schema
// asserts only what the redirect consumes (`id`); the producer emits a wider envelope
// (`{ id, parentId }`), and pinning fields the client doesn't read would assert a contract the
// consumer doesn't enforce.
const forkResponseSchema = z.object({ id: z.string().min(1) })

// [LAW:one-source-of-truth] REWRITE_DELIMITER is shared with api.rewrite-prompt.ts
// via ~/lib/rewrite-delim. The trailing \n is the parsing contract: the LLM
// emits the token on its own line, so the stream always contains DELIMITER + \n.
const REWRITE_DELIM = REWRITE_DELIMITER + "\n"

// [LAW:decomposition] Voice copy lives with the surface that speaks it. Fork and breed
// are separate pages with separate flows; their pause headlines are local to each.
// [LAW:types-are-the-program] Exhaustive over BreedPause — a missing arm makes the
// `never` default reachable and breaks `tsc -b`.
function pauseHeadline(pause: BreedPause): string {
  switch (pause.reason) {
    case 'muse-unreachable': return 'fork paused — the spirit that re-authors your wish has gone quiet; try again shortly'
    case 'muse-empty':       return 'fork paused — the muse came back empty-handed; try again'
    case 'out-of-budget':    return 'fork paused — the city has spent all it has tonight; the forge reopens by morning'
    case 'unknown':          return 'fork paused — something went wrong; try again shortly'
    default: { const _: never = pause; return _ }
  }
}

// [LAW:types-are-the-program] Carries a BreedPause through the throw so the single
// catch sets the visitor-facing pause from DATA, never by string-matching an error
// message. A throw that is NOT this — an unexpected JS error — is the `unknown` pause,
// and its detail goes to the console; the visitor only ever sees the honest headline.
// [LAW:no-silent-fallbacks] every failure that constructs one of these also logs the
// raw status/detail to the console before throwing, so the failure stays loud for
// diagnosis while the human hears the fork page's voice.
class BreedPauseError extends Error {
  constructor(readonly pause: BreedPause) {
    super(pause.reason)
  }
}

// [LAW:types-are-the-program] The loader's output is the form's exact pre-fill
// shape — one closed type, no nullables. If a row drifts (parent not found,
// upload-kind, malformed params) we throw a Response at the boundary; the
// component never sees an "incomplete" loader payload.
type ProviderOption = {
  id: string
  displayName: string
  disabled?: boolean
  // [RECONCILE C] The citizen whose medium this provider is. null when no
  // generator persona claims this provider (e.g. mock providers).
  personaName: string | null
  personaHandle: string | null
  personaAgentId: string | null
}

type LoaderData = {
  parentId: string
  parentShortId: string
  // [RECONCILE C] The parent's author's agentId — used client-side to detect
  // when the selected provider's persona differs (interspecies crossing).
  parentPersonaId: string
  providerId: string
  // [LAW:types-are-the-program] disabled carries the deregistered-provider
  // state into the type so the select renders it visibly without the
  // component needing to re-derive or branch on a separate flag.
  providers: ProviderOption[]
  // [LAW:one-source-of-truth] Per-provider prompt upper bounds keyed by
  // provider id. The textarea maxLength + counter update when the user
  // switches providers so the UX rejects over-long prompts at typing time.
  // The wire schema in api.fork.$id.ts validates against PROMPT_MAX (the
  // union ceiling) so cross-provider submissions always pass validation.
  promptMaxPerProvider: Record<string, number>
  // [LAW:types-are-the-program] Per-provider supported aspect ratios. The
  // aspect ratio selector filters to this set when the user switches providers
  // so the form can never submit a ratio the provider rejects at generate() time.
  // Mirrors promptMaxPerProvider — the constraint lives at the seam, not as a
  // runtime throw inside the provider.
  supportedAspectRatiosPerProvider: Record<string, AspectRatio[]>
  prompt: string
  styleFamily: StyleFamily
  aspectRatio: AspectRatio
  subject: RecipeSubject
  subjectPhrase: string
}

export async function loader({
  params,
  context,
}: Route.LoaderArgs): Promise<LoaderData> {
  const parent = await getPostById(context.cloudflare.env, PostId(params.id))
  if (parent === null) {
    throw new Response("post not found", { status: 404 })
  }
  if (parent.content.kind !== "generation") {
    throw new Response("only generation posts are forkable", { status: 400 })
  }

  // [LAW:one-source-of-truth] The prompt the form pre-fills is the genome's UTTERANCE — a
  // first-class heritable field now, no longer dug out of the provider-shaped params. The
  // genes carry the rest of the recipe affordances; medium is the provider gene.
  const genome = parent.content.genome

  // [LAW:single-enforcer] realProviders filters by env so mocks never appear
  // in the prod selector. If the parent's provider isn't in the available list
  // (deregistered → missing from registry; or env-filtered, e.g. mock in prod),
  // we append it as a disabled entry so the select renders a visible default
  // rather than blank. On submit the action returns 404 for deregistered and
  // 422 for env-filtered — both cases are handled there.
  const available = realProviders(context.cloudflare.env)

  // [RECONCILE C] Build a medium→persona map so each provider option can show
  // which citizen's medium it is. Loader-side resolution keeps the component
  // free of persona queries and the crossing detection purely data-driven.
  const generators = await listPersonas(context.cloudflare.env, 'generator')
  const mediumToPersona = new Map<string, typeof generators[0]>()
  for (const p of generators) {
    const medium = (p.config as { medium?: unknown }).medium
    if (typeof medium === 'string') mediumToPersona.set(medium, p)
  }

  const providers: ProviderOption[] = available.map((p) => {
    const persona = mediumToPersona.get(p.id)
    return {
      id: p.id,
      displayName: p.displayName,
      personaName: persona?.displayName ?? null,
      personaHandle: persona?.handle ?? null,
      personaAgentId: persona?.agentId ?? null,
    }
  })
  if (!providers.some((p) => p.id === genome.genes.medium)) {
    providers.push({
      id: genome.genes.medium,
      displayName: `${genome.genes.medium} (unavailable)`,
      disabled: true,
      personaName: null,
      personaHandle: null,
      personaAgentId: null,
    })
  }
  // [LAW:types-are-the-program] promptMaxLength is optional on providers that have no
  // prompt length constraint (verse). Fall back to PROMPT_MAX so the fork form always
  // has a numeric bound — the same global default the form uses when no provider is
  // selected. Line 171's `?? PROMPT_MAX` already handles a missing map key, but this
  // keeps the type concrete so existing consumers don't need to handle undefined.
  const promptMaxPerProvider: Record<string, number> = Object.fromEntries(
    available.map((p) => [p.id, p.promptMaxLength ?? PROMPT_MAX]),
  )
  // [LAW:types-are-the-program] Provider-declared aspect ratio limits flow into the
  // form so the selector only shows ratios the chosen provider can generate. Without
  // this, selecting DALL-E 3 with a 4:3 or 3:4 ratio submits an unsupported value
  // that throws inside generate() → 502 → visible error. The constraint belongs at
  // the seam (this type), not as a runtime guard inside the provider.
  // [LAW:types-are-the-program] Every selectable provider (including the disabled fallback
  // for a deregistered parent provider) has an explicit entry so the component never needs a
  // ?? fallback that would silently widen the selector back to all ratios. Disabled providers
  // use ASPECT_RATIOS — they cannot submit anyway, so any ratio is equally safe there.
  const supportedAspectRatiosPerProvider: Record<string, AspectRatio[]> = {
    ...Object.fromEntries(available.map((p) => [p.id, [...p.supportedAspectRatios]])),
    ...providers
      .filter((p) => p.disabled)
      .reduce<Record<string, AspectRatio[]>>((acc, p) => { acc[p.id] = [...ASPECT_RATIOS]; return acc }, {}),
  }

  // [LAW:types-are-the-program] parentPersonaId is carried into the loader shape so
  // the UI can detect when a different citizen's medium is selected without an extra
  // round-trip. The parent's author is always a PersonaActor for generation posts.
  const parentPersonaId = parent.origin.kind === 'authored'
    ? parent.origin.author.agentId
    : ''

  return {
    parentId: parent.id,
    parentShortId: parent.id.slice(0, 8),
    parentPersonaId,
    providerId: genome.genes.medium,
    providers,
    promptMaxPerProvider,
    supportedAspectRatiosPerProvider,
    prompt: genome.utterance,
    styleFamily: genome.genes.species,
    // [LAW:types-are-the-program] Clamp to the initial provider's supported set so
    // the component's initial state is always valid — the parent's ratio may not be
    // in the set if the parent's provider was deregistered and a different real
    // provider is now selected as the default.
    aspectRatio: (supportedAspectRatiosPerProvider[genome.genes.medium] ?? ASPECT_RATIOS)
      .includes(genome.genes.frame)
      ? genome.genes.frame
      : (supportedAspectRatiosPerProvider[genome.genes.medium]?.[0] ?? ASPECT_RATIOS[0]),
    subject: genome.genes.form,
    // [LAW:one-source-of-truth] renderTemplate is the shared filler that
    // resolves `{slot}` placeholders into vocab values and normalizes a/an
    // articles. Using it here means the "subject" affordance shows what the
    // user is actually forking ("a marmoset performing an act of embarrassed")
    // rather than the raw template ("an {animal} performing an act of {emotion}").
    subjectPhrase: renderTemplate(genome.genes.form),
  }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Fork — SlopSpot" }]
}

// [LAW:types-are-the-program] Three-value phase discriminant replaces the
// boolean `submitting` flag. The illegal state "rewriting AND submitting
// simultaneously" is unrepresentable. The button label and disabled state
// derive from this one value with no additional flags.
type Phase = "editing" | "rewriting" | "submitting"

export default function ForkPage({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const [providerId, setProviderId] = useState(loaderData.providerId)
  const [prompt, setPrompt] = useState(loaderData.prompt)
  // [RECONCILE C] Interspecies crossing indicator: selected provider's persona
  // differs from parent's author. Data-driven — no extra state needed.
  const selectedProviderOption = loaderData.providers.find(p => p.id === providerId)
  const isCrossing = selectedProviderOption?.personaAgentId !== null
    && selectedProviderOption?.personaAgentId !== loaderData.parentPersonaId
  const [styleFamily, setStyleFamily] = useState<StyleFamily>(loaderData.styleFamily)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(loaderData.aspectRatio)
  // [LAW:types-are-the-program] Derive the allowed aspect ratios from the selected
  // provider. When the user switches providers, any currently-selected ratio that is
  // not in the new provider's set gets clamped to the first supported one — the illegal
  // state (selected ratio ∉ provider.supportedAspectRatios) is prevented in the value,
  // not caught at generate() time.
  // [LAW:types-are-the-program] Every provider (including disabled) has an entry in the map
  // built by the loader, so a missing key is a loader bug, not a runtime variant to handle.
  // The non-null assertion surfaces that assumption loudly. [LAW:no-defensive-null-guards]
  const allowedAspectRatios: AspectRatio[] =
    loaderData.supportedAspectRatiosPerProvider[providerId]!

  function handleProviderChange(newProviderId: string) {
    setProviderId(newProviderId)
    const supported = loaderData.supportedAspectRatiosPerProvider[newProviderId]!
    // [LAW:dataflow-not-control-flow] variability lives in the value, not in whether
    // setAspectRatio runs — always call it; the ternary picks which ratio to keep.
    setAspectRatio(supported.includes(aspectRatio) ? aspectRatio : supported[0])
  }

  const [phase, setPhase] = useState<Phase>("editing")
  const [thinkingText, setThinkingText] = useState("")
  // [LAW:types-are-the-program] The error state is a BreedPause, not a string —
  // there is no field on this type that can hold a raw HTTP status or body, so the
  // old `rewrite failed: 502 {…}` leak is unrepresentable. The visitor only ever
  // sees the honest headline derived from this value.
  const [pause, setPause] = useState<BreedPause | null>(null)
  const promptMax = loaderData.promptMaxPerProvider[providerId] ?? PROMPT_MAX
  // [LAW:single-enforcer] Synchronous re-entrancy guard, same shape as
  // VoteControls + CommentSection. `setPhase('rewriting')` is queued for the
  // next render, so a rapid second click inside the same microtask would
  // still see `phase === 'editing'` from React state. The ref mutates
  // synchronously, so the second click bails on the same tick. This matters
  // more here than on votes/comments because each fork triggers a paid
  // provider call — a double-fire would charge twice.
  const inFlight = useRef(false)
  // [LAW:single-enforcer] Single abort controller for all in-flight requests
  // (rewrite + fork). Cancelling on unmount propagates to the Worker, which
  // then cancels the upstream Anthropic stream via request.signal.
  const abortRef = useRef<AbortController | null>(null)
  useEffect(() => () => { abortRef.current?.abort() }, [])

  const locked = phase !== "editing"

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    const seed = prompt.trim()
    // [LAW:single-enforcer] The submit button is disabled while the prompt is empty;
    // that disabled state is the one gate on "nothing to breed from," so this is a
    // bare re-entrancy/Enter-key guard, not a second validation path with its own copy.
    if (seed.length === 0) return
    inFlight.current = true
    const abort = new AbortController()
    abortRef.current = abort
    setPhase("rewriting")
    setThinkingText("")
    setPause(null)

    try {
      // Phase 1: stream the LLM rewrite.
      const rewriteRes = await fetch("/api/rewrite-prompt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: seed, styleFamily, aspectRatio }),
        signal: abort.signal,
      })

      if (!rewriteRes.ok || !rewriteRes.body) {
        // [LAW:no-silent-fallbacks] Loud for diagnosis, quiet for the visitor: the
        // raw status + body go to the console; the human hears the breeding room's
        // voice. Any rewrite-phase failure means the same thing — the muse is
        // unreachable — so the exact status steers the log, never the headline.
        const detail = await rewriteRes.text().catch(() => "")
        console.error("breed: rewrite phase failed", rewriteRes.status, detail)
        throw new BreedPauseError({ reason: "muse-unreachable" })
      }

      const reader = rewriteRes.body.getReader()
      const decoder = new TextDecoder()
      // [LAW:dataflow-not-control-flow] A single pass over the stream splits
      // it into two regions via REWRITE_DELIM. streamBuffer accumulates
      // pre-delimiter bytes; once the delimiter is found, rewrittenPrompt
      // accumulates the post-delimiter bytes and drives the textarea. No
      // branch skips characters — every byte goes somewhere.
      let streamBuffer = ""
      let delimFound = false
      let rewrittenPrompt = ""

      try { while (true) {
        const { done, value } = await reader.read()

        // Flush decoder on EOF to emit any partial UTF-8 sequence held in its
        // internal buffer; use stream mode mid-stream so multi-byte sequences
        // spanning chunk boundaries are reassembled correctly.
        const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true })

        if (chunk.length > 0) {
          if (!delimFound) {
            streamBuffer += chunk
            const idx = streamBuffer.indexOf(REWRITE_DELIM)
            if (idx !== -1) {
              delimFound = true
              const thinking = streamBuffer.slice(0, idx)
              rewrittenPrompt = streamBuffer.slice(idx + REWRITE_DELIM.length)
              setThinkingText(thinking)
              setPrompt(rewrittenPrompt)
            } else {
              // Show thinking text in real time, holding back chars that could
              // be the start of a split delimiter so they're not orphaned in
              // the thinking block if the delimiter arrives on the next chunk.
              const safeLen = Math.max(0, streamBuffer.length - (REWRITE_DELIM.length - 1))
              setThinkingText(streamBuffer.slice(0, safeLen))
            }
          } else {
            rewrittenPrompt += chunk
            setPrompt(rewrittenPrompt)
          }
        }

        if (done) break
      } } finally { reader.releaseLock() }

      if (!delimFound) {
        console.error(`breed: rewrite stream ended without ${REWRITE_DELIMITER} delimiter`)
        throw new BreedPauseError({ reason: "muse-empty" })
      }

      // Trim and cap to the provider's promptMax — the LLM may write more than
      // the selected provider accepts, and silently truncating matches the same
      // constraint the textarea maxLength enforces during manual editing.
      const submittablePrompt = rewrittenPrompt.trim().slice(0, promptMax)
      if (!submittablePrompt) {
        console.error("breed: rewrite produced an empty prompt")
        throw new BreedPauseError({ reason: "muse-empty" })
      }
      // Sync textarea to submittablePrompt so the displayed text matches what
      // gets submitted — if the fork fails and the phase returns to editing,
      // the user sees the capped version and the submit button stays enabled.
      setPrompt(submittablePrompt)

      // Phase 2: auto-submit the fork with the AI-authored prompt.
      setPhase("submitting")

      const res = await fetch(`/api/fork/${loaderData.parentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt: submittablePrompt,
          styleFamily,
          aspectRatio,
          providerId,
        }),
        signal: abort.signal,
      })
      if (!res.ok) {
        // [LAW:no-silent-fallbacks] Raw status + body to the console; the visitor
        // hears the voice. The fork status selects a pause reason from data — 429 (the
        // daily budget cap) is voiced distinctly; any other failure is the quiet pause.
        const detail = await res.text().catch(() => "")
        console.error("breed: fork phase failed", res.status, detail)
        throw new BreedPauseError(forkPause(res.status))
      }
      // [LAW:single-enforcer] Navigate to the new post's permalink, not to
      // home. The feed orders by (score DESC, createdAt DESC), so a fresh
      // fork at score 0 lands below any higher-scored posts — possibly off
      // the visible viewport, which was the "did anything happen?" UX gap
      // ec7.3.2 closes. forkResponseSchema (module-scope above) pins the
      // wire contract this redirect rides on.
      const { id: newPostId } = forkResponseSchema.parse(await res.json())
      navigate(`/p/${newPostId}`)
    } catch (err) {
      // An aborted request is an unmount/navigation, not a failure to voice.
      if (abort.signal.aborted) return
      // [LAW:types-are-the-program] The pause is read from the thrown value's data; an
      // unexpected throw (not a BreedPauseError) is the `unknown` pause and its detail
      // is logged here, never shown — the visitor only ever sees the honest headline.
      if (err instanceof BreedPauseError) {
        setPause(err.pause)
      } else {
        console.error("breed: unexpected failure", err)
        setPause({ reason: "unknown" })
      }
      setPhase("editing")
    } finally {
      inFlight.current = false
    }
  }

  const buttonLabel =
    phase === "rewriting" ? "Rewriting…" : phase === "submitting" ? "Generating…" : "Fork"

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8 border-b border-white/10 pb-6">
        {/* [LAW:one-source-of-truth] React Router's <Link> is the canonical
            in-app navigation primitive — client-side routing, no full
            document reload. A bare anchor would tear down React and
            refetch the whole bundle for an internal jump. */}
        <Link
          to="/"
          className="font-mono text-xs uppercase tracking-[0.25em] text-white/40 transition hover:text-white/70"
        >
          ← back to slopspot
        </Link>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
          Fork{" "}
          <span className="font-mono text-xl text-emerald-400">
            p:{loaderData.parentShortId}
          </span>
        </h1>
        <p className="mt-2 font-mono text-xs text-white/50">
          edit the recipe, keep the lineage
        </p>
      </header>

      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <Field label="medium">
          <select
            value={providerId}
            onChange={(e) => handleProviderChange(e.target.value)}
            disabled={locked}
            className="block w-full rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white/85 focus:border-emerald-400/60 focus:outline-none disabled:opacity-50"
          >
            {loaderData.providers.map((p) => (
              <option key={p.id} value={p.id} disabled={p.disabled}>
                {p.personaName !== null ? `${p.personaName} — ${p.displayName}` : p.displayName}
              </option>
            ))}
          </select>
          {isCrossing && selectedProviderOption !== undefined && selectedProviderOption.personaName !== null && (
            <p className="mt-1 font-mono text-[11px] text-fuchsia-400/80">
              ⑂ interspecies — hybrid attributed out of lineage, by {selectedProviderOption.personaName}
            </p>
          )}
        </Field>

        <InfoField label="subject" hint="preserved from parent">
          <ReadOnlyValue>{loaderData.subjectPhrase}</ReadOnlyValue>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/65">
{JSON.stringify(loaderData.subject, null, 2)}
          </pre>
        </InfoField>

        <Field label="prompt" hint={`${prompt.trim().length}/${promptMax}`}>
          {thinkingText.length > 0 && (
            <div className="rounded border border-white/10 bg-black/40 px-3 py-2">
              <p className="font-mono text-[11px] italic leading-relaxed text-white/40 whitespace-pre-wrap break-words">
                {thinkingText}
              </p>
            </div>
          )}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={promptMax}
            rows={5}
            disabled={locked}
            className="block w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm leading-relaxed text-white/85 placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none disabled:opacity-50"
          />
        </Field>

        <Field label="style family">
          <select
            value={styleFamily}
            onChange={(e) => {
              const next = e.target.value as StyleFamily
              const oldSeed = STYLE_FAMILY_PROMPT_SEEDS[styleFamily]
              const newSeed = STYLE_FAMILY_PROMPT_SEEDS[next]
              // [LAW:types-are-the-program] replaceAll, not replace —
              // a prompt that mentions the seed more than once would
              // otherwise end up with both old and new seeds coexisting,
              // reintroducing the drift this handler exists to prevent.
              // The post-swap state is "every occurrence of oldSeed is
              // newSeed" by construction.
              setPrompt(prev => prev.includes(oldSeed) ? prev.replaceAll(oldSeed, newSeed) : prev)
              setStyleFamily(next)
            }}
            disabled={locked}
            className="block w-full rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white/85 focus:border-emerald-400/60 focus:outline-none disabled:opacity-50"
          >
            {STYLE_FAMILIES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>

        <Field label="aspect ratio">
          <select
            value={aspectRatio}
            onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
            disabled={locked}
            className="block w-full rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white/85 focus:border-emerald-400/60 focus:outline-none disabled:opacity-50"
          >
            {allowedAspectRatios.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-center justify-between pt-2">
          <span className="font-mono text-[11px] text-white/40">
            {phase === "editing" ? "submit to fork" : phase === "rewriting" ? "rewriting prompt…" : "generating image…"}
          </span>
          {/* [LAW:types-are-the-program] The idle↔busy label is a DISCRETE state
              ({buttonLabel} swaps atomically with `phase`); the hover tint is a
              CONTINUOUS affordance. `transition-colors` (not the broad `transition`)
              animates only the colour group, so `disabled:opacity-40` flips
              instantly instead of riding a 150ms opacity transition. A transitioned
              opacity promotes the button to its own compositor layer and cross-fades
              the old label's paint into the new one — the two states becoming legible
              at once. Scoping the transition makes them mutually exclusive at the
              paint layer by construction, not by hiding the overlap on a timer. */}
          <button
            type="submit"
            disabled={locked || prompt.trim().length === 0 || prompt.trim().length > promptMax}
            className="rounded bg-emerald-400/20 px-4 py-2 font-mono text-xs uppercase tracking-wider text-emerald-300 transition-colors hover:bg-emerald-400/30 disabled:opacity-40"
          >
            {buttonLabel}
          </button>
        </div>

        {pause !== null && (
          <p className="rounded border border-rose-400/30 bg-rose-400/5 px-3 py-2 font-mono text-[11px] text-rose-300/90">
            {pauseHeadline(pause)}
          </p>
        )}
      </form>
    </main>
  )
}

// [LAW:types-are-the-program] Two wrapper components instead of one with a
// mode flag. `<label>` is for form controls (clicking the label focuses the
// input). `<div>` is for read-only displays, which may contain non-phrasing
// content like `<pre>` that `<label>` does not permit. A single Field with a
// boolean `readOnly` prop would have to branch on the discriminator at render
// time and admit nonsense states ("readOnly label wrapping an input"); two
// components make the right element-type a property of which component the
// caller chose, structural rather than runtime.
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <FieldHeader label={label} hint={hint} />
      {children}
    </label>
  )
}

function InfoField({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldHeader label={label} hint={hint} />
      {children}
    </div>
  )
}

function FieldHeader({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-white/50">
      <span>{label}</span>
      {hint !== undefined && <span className="text-white/35">{hint}</span>}
    </span>
  )
}

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return (
    <span className="block rounded border border-white/5 bg-white/[0.02] px-3 py-2 font-mono text-sm text-white/65">
      {children}
    </span>
  )
}
