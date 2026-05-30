import type { Route } from "./+types/fork.$id"
import { useRef, useState } from "react"
import { Link, useNavigate } from "react-router"
import { z } from "zod"
import { getPostById } from "~/db/feed"
import { realProviders } from "~/providers"
import { PROMPT_MAX } from "~/lib/fork-bounds"
import {
  PostId,
  type AspectRatio,
  type RecipeSubject,
  type StyleFamily,
} from "~/lib/domain"
import { ASPECT_RATIOS, STYLE_FAMILIES, STYLE_FAMILY_PROMPT_SEEDS, renderTemplate } from "~/lib/variety"

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

// Each provider's paramsSchema has `prompt: string` — the canonical "what to
// generate" field. The form lets the user edit this; other provider-specific
// tunables (steps / negativePrompt / seed / styleType) are re-derived from
// the recipe in the action via defaultParamsForRecipe, mirroring the firehose
// chooser's translation. `.trim()` mirrors the body schema's trim so a parent
// stored with incidental whitespace doesn't pre-fill an effectively-empty
// prompt. PROMPT_MAX is imported from `~/lib/fork-bounds`, the shared client/
// server-safe module that holds the union ceiling — wide enough to accept any
// parent's stored prompt; the per-provider tighter bound (provider.promptMaxLength)
// drives the form's maxLength + counter.
const promptedParamsSchema = z
  .object({ prompt: z.string().trim().min(1).max(PROMPT_MAX) })
  .passthrough()

// [LAW:one-source-of-truth] The response contract from /api/fork/:id, pinned
// here at module scope (same pattern as promptedParamsSchema above) — defined
// once per file load, not re-instantiated on every form submit. The schema
// asserts only what the redirect consumes (`id`); the producer emits a wider
// envelope (`{ id, parentId }`), and pinning fields the client doesn't read
// would assert a contract the consumer doesn't enforce.
const forkResponseSchema = z.object({ id: z.string().min(1) })

// [LAW:types-are-the-program] The loader's output is the form's exact pre-fill
// shape — one closed type, no nullables. If a row drifts (parent not found,
// upload-kind, malformed params) we throw a Response at the boundary; the
// component never sees an "incomplete" loader payload.
type LoaderData = {
  parentId: string
  parentShortId: string
  providerId: string
  // [LAW:types-are-the-program] disabled carries the deregistered-provider
  // state into the type so the select renders it visibly without the
  // component needing to re-derive or branch on a separate flag.
  providers: Array<{ id: string; displayName: string; disabled?: boolean }>
  // [LAW:one-source-of-truth] Per-provider prompt upper bounds keyed by
  // provider id. The textarea maxLength + counter update when the user
  // switches providers so the UX rejects over-long prompts at typing time.
  // The wire schema in api.fork.$id.ts validates against PROMPT_MAX (the
  // union ceiling) so cross-provider submissions always pass validation.
  promptMaxPerProvider: Record<string, number>
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

  // The recipe's params is `unknown` at the domain boundary; every provider's
  // paramsSchema requires `prompt: string`, so a passthrough parse extracts
  // it without coupling to any single provider's full shape. A row whose
  // stored params has no prompt fails loud here — that would be a createPost
  // invariant violation, not a normal-path case.
  const prompted = promptedParamsSchema.parse(parent.content.recipe.params)

  // [LAW:single-enforcer] realProviders filters by env so mocks never appear
  // in the prod selector. If the parent's provider was deregistered it won't
  // appear in `available`; we append it as a disabled entry so the select
  // renders a visible default rather than a blank, and the action's 404 arm
  // already handles a stale id on submit.
  // [LAW:types-are-the-program] Extract the recipe into a local so TypeScript
  // preserves the post-narrowing type inside lambda callbacks below.
  const recipe = parent.content.recipe
  const available = realProviders(context.cloudflare.env)
  const providers: Array<{ id: string; displayName: string; disabled?: boolean }> = available.map(
    (p) => ({ id: p.id, displayName: p.displayName }),
  )
  if (!providers.some((p) => p.id === recipe.providerId)) {
    providers.push({
      id: recipe.providerId,
      displayName: `${recipe.providerId} (unavailable)`,
      disabled: true,
    })
  }
  const promptMaxPerProvider: Record<string, number> = Object.fromEntries(
    available.map((p) => [p.id, p.promptMaxLength]),
  )

  return {
    parentId: parent.id,
    parentShortId: parent.id.slice(0, 8),
    providerId: recipe.providerId,
    providers,
    promptMaxPerProvider,
    prompt: prompted.prompt,
    styleFamily: recipe.styleFamily,
    aspectRatio: recipe.aspectRatio,
    subject: recipe.subject,
    // [LAW:one-source-of-truth] renderTemplate is the shared filler that
    // resolves `{slot}` placeholders into vocab values and normalizes a/an
    // articles. Using it here means the "subject" affordance shows what the
    // user is actually forking ("a marmoset performing an act of embarrassed")
    // rather than the raw template ("an {animal} performing an act of {emotion}").
    subjectPhrase: renderTemplate(recipe.subject),
  }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Fork — SlopSpot" }]
}

export default function ForkPage({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const [providerId, setProviderId] = useState(loaderData.providerId)
  const [prompt, setPrompt] = useState(loaderData.prompt)
  const [styleFamily, setStyleFamily] = useState<StyleFamily>(loaderData.styleFamily)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(loaderData.aspectRatio)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const promptMax = loaderData.promptMaxPerProvider[providerId] ?? PROMPT_MAX
  // [LAW:single-enforcer] Synchronous re-entrancy guard, same shape as
  // VoteControls + CommentSection. `setSubmitting(true)` is queued for the
  // next render, so a rapid second click inside the same microtask would
  // still see `submitting === false` from React state. The ref mutates
  // synchronously, so the second click bails on the same tick. This matters
  // more here than on votes/comments because each fork triggers a paid
  // provider call — a double-fire would charge twice.
  const inFlight = useRef(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (inFlight.current) return
    const trimmed = prompt.trim()
    if (trimmed.length === 0) {
      setError("prompt cannot be empty")
      return
    }
    inFlight.current = true
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/fork/${loaderData.parentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, styleFamily, aspectRatio, providerId }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => "")
        throw new Error(`fork failed: ${res.status} ${detail}`.trim())
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
      setError(String(err))
    } finally {
      setSubmitting(false)
      inFlight.current = false
    }
  }

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
        <Field label="provider">
          <select
            value={providerId}
            onChange={(e) => setProviderId(e.target.value)}
            disabled={submitting}
            className="block w-full rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white/85 focus:border-emerald-400/60 focus:outline-none disabled:opacity-50"
          >
            {loaderData.providers.map((p) => (
              <option key={p.id} value={p.id} disabled={p.disabled}>
                {p.displayName}
              </option>
            ))}
          </select>
        </Field>

        <InfoField label="subject" hint="preserved from parent">
          <ReadOnlyValue>{loaderData.subjectPhrase}</ReadOnlyValue>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/65">
{JSON.stringify(loaderData.subject, null, 2)}
          </pre>
        </InfoField>

        <Field label="prompt" hint={`${prompt.trim().length}/${promptMax}`}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={promptMax}
            rows={5}
            disabled={submitting}
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
            disabled={submitting}
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
            disabled={submitting}
            className="block w-full rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white/85 focus:border-emerald-400/60 focus:outline-none disabled:opacity-50"
          >
            {ASPECT_RATIOS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>

        <div className="flex items-center justify-between pt-2">
          <span className="font-mono text-[11px] text-white/40">
            {submitting ? "generating…" : "submit to fork"}
          </span>
          <button
            type="submit"
            disabled={submitting || prompt.trim().length === 0}
            className="rounded bg-emerald-400/20 px-4 py-2 font-mono text-xs uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-400/30 disabled:opacity-40"
          >
            {submitting ? "forking…" : "fork"}
          </button>
        </div>

        {error !== null && (
          <p className="rounded border border-rose-400/30 bg-rose-400/5 px-3 py-2 font-mono text-[11px] text-rose-300/90">
            {error}
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
