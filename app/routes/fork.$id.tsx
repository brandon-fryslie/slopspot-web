import type { Route } from "./+types/fork.$id"
import { useState } from "react"
import { useNavigate } from "react-router"
import { z } from "zod"
import { getPostById } from "~/db/feed"
import { getProvider, UnknownProviderError } from "~/providers"
import {
  PostId,
  type AspectRatio,
  type RecipeSubject,
  type StyleFamily,
} from "~/lib/domain"
import { ASPECT_RATIOS, STYLE_FAMILIES, TEMPLATE_PHRASES } from "~/lib/variety"

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
// tunables (steps / negativePrompt / seed / styleType) are re-derived from the
// recipe in the action via defaultParamsForRecipe, mirroring the firehose
// chooser's translation.
const promptedParamsSchema = z
  .object({ prompt: z.string().min(1).max(1000) })
  .passthrough()

const PROMPT_MAX = 1000

// [LAW:types-are-the-program] The loader's output is the form's exact pre-fill
// shape — one closed type, no nullables. If a row drifts (parent not found,
// upload-kind, malformed params) we throw a Response at the boundary; the
// component never sees an "incomplete" loader payload.
type LoaderData = {
  parentId: string
  parentShortId: string
  providerId: string
  providerDisplayName: string
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

  let providerDisplayName: string = parent.content.recipe.providerId
  try {
    providerDisplayName = getProvider(parent.content.recipe.providerId).displayName
  } catch (e) {
    if (!(e instanceof UnknownProviderError)) throw e
    // The provider was deregistered since the parent's creation. Surface the
    // raw id rather than crashing the form; the action returns 404 if the
    // user submits.
  }

  return {
    parentId: parent.id,
    parentShortId: parent.id.slice(0, 8),
    providerId: parent.content.recipe.providerId,
    providerDisplayName,
    prompt: prompted.prompt,
    styleFamily: parent.content.recipe.styleFamily,
    aspectRatio: parent.content.recipe.aspectRatio,
    subject: parent.content.recipe.subject,
    subjectPhrase: TEMPLATE_PHRASES[parent.content.recipe.subject.subjectTemplate],
  }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Fork — SlopSpot" }]
}

export default function ForkPage({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate()
  const [prompt, setPrompt] = useState(loaderData.prompt)
  const [styleFamily, setStyleFamily] = useState<StyleFamily>(loaderData.styleFamily)
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>(loaderData.aspectRatio)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (submitting) return
    const trimmed = prompt.trim()
    if (trimmed.length === 0) {
      setError("prompt cannot be empty")
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/fork/${loaderData.parentId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: trimmed, styleFamily, aspectRatio }),
      })
      if (!res.ok) {
        const detail = await res.text().catch(() => "")
        throw new Error(`fork failed: ${res.status} ${detail}`.trim())
      }
      // Fork succeeded → navigate to home. The new post is already inserted
      // (createPost is synchronous on success) so it appears at the top of
      // the feed once createdAt ordering is applied.
      navigate("/")
    } catch (err) {
      setError(String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8 border-b border-white/10 pb-6">
        <a
          href="/"
          className="font-mono text-xs uppercase tracking-[0.25em] text-white/40 transition hover:text-white/70"
        >
          ← back to slopspot
        </a>
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
        <Field label="provider" hint="preserved from parent">
          <ReadOnlyValue>{loaderData.providerDisplayName}</ReadOnlyValue>
        </Field>

        <Field label="subject" hint="preserved from parent">
          <ReadOnlyValue>{loaderData.subjectPhrase}</ReadOnlyValue>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-white/65">
{JSON.stringify(loaderData.subject, null, 2)}
          </pre>
        </Field>

        <Field label="prompt" hint={`${prompt.trim().length}/${PROMPT_MAX}`}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={PROMPT_MAX}
            rows={5}
            disabled={submitting}
            className="block w-full resize-y rounded border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm leading-relaxed text-white/85 placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none disabled:opacity-50"
          />
        </Field>

        <Field label="style family">
          <select
            value={styleFamily}
            onChange={(e) => setStyleFamily(e.target.value as StyleFamily)}
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
      <span className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider text-white/50">
        <span>{label}</span>
        {hint !== undefined && <span className="text-white/35">{hint}</span>}
      </span>
      {children}
    </label>
  )
}

function ReadOnlyValue({ children }: { children: React.ReactNode }) {
  return (
    <span className="block rounded border border-white/5 bg-white/[0.02] px-3 py-2 font-mono text-sm text-white/65">
      {children}
    </span>
  )
}
