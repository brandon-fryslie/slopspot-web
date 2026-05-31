import type { Route } from "./+types/submit"
import { Form, Link, redirect, useActionData, useNavigation } from "react-router"
import { z } from "zod"
import { createPost } from "~/db/posts"
import { resolveVoter } from "~/lib/voter-cookie"
import { isSameOrigin } from "~/lib/same-origin"
import { tryReserveFoundSubmission, FOUND_DAILY_CAP } from "~/lib/found-quota"
import { authorLabel } from "~/lib/author-label"
import type { FoundOrigin } from "~/lib/domain"

// [LAW:single-enforcer] The HTML form trust boundary for found-content
// submission. The JSON wire route at /api/found owns programmatic submitters
// (agents, JS-enhanced clients); this page owns the cookie-authenticated
// browser-form path. Both routes pass through the same writer (createPost)
// and the same per-voter quota (tryReserveFoundSubmission), so the storage
// invariants are identical regardless of which entry the user came through.
//
// The two entry points exist because their *request and response shapes
// differ at the wire*: /api/found takes JSON and returns JSON; /submit takes
// form-encoded and returns redirect-or-rerendered-HTML. Routing each shape
// to its own handler is [LAW:locality-or-seam] — the variability that lives
// at the boundary stays at the boundary, and neither route has to branch on
// content-type or response-acceptable.
//
// [LAW:types-are-the-program] The action result is a discriminated union.
// Success is a `redirect` Response (no data shape — the browser just
// follows). Failure is a typed result object; the component renders the
// error variant exhaustively. There is no implicit success-with-data path,
// no mixed shape that a renderer has to defensively interpret.

// [LAW:types-are-the-program] Identical shape to /api/found's schema, so
// both routes funnel the same constrained state into createPost.
//   url:   http(s)-only via `z.url({ protocol: /^https?$/ })` — rejects
//          `javascript:` and friends at the boundary, so the rendered
//          anchor `href` cannot execute script on click. XSS by storage
//          is unrepresentable.
//   description?: empty-after-trim normalized to absent (preprocess →
//          undefined → optional). The schema's preprocess also collapses
//          whitespace-only input, so the route no longer needs pre-Zod
//          length checks.
const bodySchema = z.object({
  url: z.url({ protocol: /^https?$/ }).max(4096),
  title: z.string().trim().min(1).max(300),
  description: z.preprocess(
    (v) => (typeof v === "string" && v.trim().length === 0 ? undefined : v),
    z.string().trim().max(2000).optional(),
  ),
})

// [LAW:types-are-the-program] The error variants are closed. Adding a new
// failure mode forces the renderer's exhaustive switch to grow an arm. The
// `values` carry the user's prior input so the re-rendered form does not
// blank out their work — same shape every error variant.
type ActionError =
  | { kind: "invalid"; fieldErrors: Partial<Record<"url" | "title" | "description", string>> }
  | { kind: "rate-limited"; retryAfter: string }
  | { kind: "cross-origin" }

type ActionResult = {
  ok: false
  error: ActionError
  values: { url: string; title: string; description: string }
}

export async function action({ request, context }: Route.ActionArgs) {
  // [LAW:single-enforcer] Same-origin gate shared with the JSON wire route
  // and the /vote, /comments, /fork routes. Native browser form submission
  // always includes Origin for cross-origin posts, so the gate's "absent
  // Origin = same-origin" arm holds for legitimate first-party submits.
  if (!isSameOrigin(request)) {
    return {
      ok: false as const,
      error: { kind: "cross-origin" as const },
      values: { url: "", title: "", description: "" },
    } satisfies ActionResult
  }

  const formData = await request.formData()
  const values = {
    url: String(formData.get("url") ?? ""),
    title: String(formData.get("title") ?? ""),
    description: String(formData.get("description") ?? ""),
  }
  // [LAW:single-enforcer] Normalization lives in bodySchema's description
  // preprocess — empty / whitespace-only strings collapse to undefined
  // there, so storage never sees a "" description. The route hands the raw
  // form values to Zod; the schema is the boundary that decides.
  const parsed = bodySchema.safeParse(values)
  if (!parsed.success) {
    const fieldErrors: Partial<Record<"url" | "title" | "description", string>> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0]
      if (
        (key === "url" || key === "title" || key === "description") &&
        fieldErrors[key] === undefined
      ) {
        fieldErrors[key] = issue.message
      }
    }
    return {
      ok: false as const,
      error: { kind: "invalid" as const, fieldErrors },
      values,
    } satisfies ActionResult
  }

  const voter = resolveVoter(request)

  const reservation = await tryReserveFoundSubmission(
    context.cloudflare.env,
    voter.voterId,
  )
  if (reservation.kind === "exhausted") {
    return {
      ok: false as const,
      error: { kind: "rate-limited" as const, retryAfter: reservation.retryAfter },
      values,
    } satisfies ActionResult
  }

  // [LAW:types-are-the-program] A human-submitted found slop credits a FINDER, not an
  // author — nobody authored the linked image here. authorLabel() in ~/lib/author-label
  // is the one place a voter UUID becomes its anon display string.
  const origin: FoundOrigin = {
    kind: "found",
    finder: { kind: "anon", label: authorLabel(voter.voterId) },
  }

  const post = await createPost(
    {
      kind: "found",
      url: parsed.data.url,
      title: parsed.data.title,
      ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      origin,
    },
    { env: context.cloudflare.env },
  )

  // [LAW:single-enforcer] One redirect target — /p/:id is the canonical
  // permalink (interactions-ec7.3.2). Same target the fork submit handler
  // uses, for the same reason: a freshly-written post is invisible in the
  // default feed order until it accrues votes/age, so navigate to the
  // permalink so the user has immediate visual confirmation.
  const headers = new Headers()
  if (voter.setCookieHeader !== null) {
    headers.set("set-cookie", voter.setCookieHeader)
  }
  return redirect(`/p/${post.id}`, { headers })
}

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Submit found slop — SlopSpot" },
    {
      name: "description",
      content:
        "Submit an outbound link to AI-generated content you discovered. Reddit-style: a URL, a title, optionally some words.",
    },
  ]
}

export default function SubmitPage() {
  const result = useActionData<typeof action>() as ActionResult | undefined
  const navigation = useNavigation()
  const submitting = navigation.state === "submitting"

  // [LAW:types-are-the-program] When the form has not yet been submitted,
  // result is undefined and every field error / banner is absent by
  // construction. After a failed submit, result is an ActionResult with a
  // closed `error` discriminator the renderer switches on exhaustively.
  const fieldErrors =
    result?.error.kind === "invalid" ? result.error.fieldErrors : {}
  const values = result?.values ?? { url: "", title: "", description: "" }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10">
      <header className="mb-8 border-b border-white/10 pb-6">
        <Link
          to="/"
          className="font-mono text-xs uppercase tracking-[0.25em] text-white/40 transition hover:text-white/70"
        >
          ← back to slopspot
        </Link>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white">
          submit <span className="text-emerald-400">found slop</span>
        </h1>
        <p className="mt-2 font-mono text-xs text-white/55">
          paste a link to AI-generated content you discovered. up to {FOUND_DAILY_CAP} submissions per day.
        </p>
      </header>

      {result !== undefined && <ErrorBanner error={result.error} />}

      <Form method="post" className="flex flex-col gap-5">
        <Field
          name="url"
          label="url"
          type="url"
          required
          autoFocus
          maxLength={4096}
          defaultValue={values.url}
          placeholder="https://civitai.com/images/12345"
          error={fieldErrors.url}
        />
        <Field
          name="title"
          label="title"
          type="text"
          required
          maxLength={300}
          defaultValue={values.title}
          placeholder="a one-line headline for the feed row"
          error={fieldErrors.title}
        />
        <TextAreaField
          name="description"
          label="description (optional)"
          maxLength={2000}
          defaultValue={values.description}
          placeholder="optional context — what makes this slop, where did you find it, etc."
          error={fieldErrors.description}
        />
        <button
          type="submit"
          disabled={submitting}
          className="self-start rounded bg-emerald-400/20 px-4 py-2 font-mono text-xs uppercase tracking-wider text-emerald-300 transition hover:bg-emerald-400/30 disabled:opacity-40"
        >
          {submitting ? "submitting…" : "submit"}
        </button>
      </Form>
    </main>
  )
}

// [LAW:types-are-the-program] Compile-time exhaustive switch on the closed
// ActionError union. The `default: const _never: never = error` arm is the
// enforcement — without it the switch is merely conventional, and a new
// variant would silently fall through to `undefined` at runtime (this
// project's tsconfig does not enable `noImplicitReturns`). With it, adding
// a new ActionError variant fails to narrow to `never` and triggers a
// compile error at the assignment, so the structure matches the claim.
function ErrorBanner({ error }: { error: ActionError }) {
  switch (error.kind) {
    case "invalid":
      return (
        <div
          role="alert"
          className="mb-6 rounded border border-rose-400/40 bg-rose-400/10 px-3 py-2 font-mono text-[11px] text-rose-300/90"
        >
          fix the highlighted fields and try again
        </div>
      )
    case "rate-limited":
      return (
        <div
          role="alert"
          className="mb-6 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 font-mono text-[11px] text-amber-300/90"
        >
          you have hit the daily submission cap ({FOUND_DAILY_CAP}/day). resets at{" "}
          {new Date(error.retryAfter).toUTCString()}.
        </div>
      )
    case "cross-origin":
      return (
        <div
          role="alert"
          className="mb-6 rounded border border-rose-400/40 bg-rose-400/10 px-3 py-2 font-mono text-[11px] text-rose-300/90"
        >
          cross-origin submission rejected
        </div>
      )
    default: {
      const _never: never = error
      throw new Error(`unhandled ActionError: ${String(_never)}`)
    }
  }
}

function Field({
  name,
  label,
  type,
  required,
  maxLength,
  defaultValue,
  placeholder,
  autoFocus,
  error,
}: {
  name: string
  label: string
  type: "url" | "text"
  required?: boolean
  maxLength: number
  defaultValue?: string
  placeholder?: string
  autoFocus?: boolean
  error?: string
}) {
  const errorId = error !== undefined ? `${name}-error` : undefined
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wider text-white/55">
        {label}
      </span>
      <input
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={errorId}
        className="rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-sm text-white/85 placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none"
      />
      {error !== undefined && (
        <span id={errorId} className="font-mono text-[11px] text-rose-300/90">
          {error}
        </span>
      )}
    </label>
  )
}

function TextAreaField({
  name,
  label,
  maxLength,
  defaultValue,
  placeholder,
  error,
}: {
  name: string
  label: string
  maxLength: number
  defaultValue?: string
  placeholder?: string
  error?: string
}) {
  const errorId = error !== undefined ? `${name}-error` : undefined
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[11px] uppercase tracking-wider text-white/55">
        {label}
      </span>
      <textarea
        name={name}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        rows={4}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={errorId}
        className="resize-y rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-sm text-white/85 placeholder:text-white/30 focus:border-emerald-400/60 focus:outline-none"
      />
      {error !== undefined && (
        <span id={errorId} className="font-mono text-[11px] text-rose-300/90">
          {error}
        </span>
      )}
    </label>
  )
}
