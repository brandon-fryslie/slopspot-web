// [LAW:single-enforcer] The ONE place that reads a D1 batch statement's raw result.
//
// drizzle's `.batch()` return type LIES: it claims each element is a mapped run
// result, but at runtime each element is a raw Cloudflare `D1Result`, and drizzle's
// `mapRunResult` never inspects `D1Result.success`. So a per-statement failure inside
// a batch resolves WITHOUT throwing — the non-transactional partial-commit mode that
// caused the May-2026 orphan-post outage. Every writer that guards that mode
// (createPost's orphan cleanup, setVote's vote/score split, recordRemark's loud
// failure) must reach `.success` through an `as unknown as ...` double-cast, which
// bypasses the type checker entirely.
//
// [LAW:single-enforcer] That bypass — the dangerous part — lives here exactly once.
// If a drizzle upgrade renames/removes the field, the SHAPE CONTRACT test on this
// helper (d1-batch.test.ts) trips RED, instead of the defense dead-ending silently
// (always-truthy `.success` → orphan-blindness with no alarm) at eleven call sites.
//
// [LAW:one-type-per-behavior] Reading a batch statement result is ONE behavior; this
// is its one type and one accessor. Call sites keep their own control flow (cleanup,
// `continue`, drift-and-self-heal, 0-row detection) and read the typed fields they
// need — none re-mint the cast.

// [LAW:types-are-the-program] The strongest TRUE theorem about a raw D1 statement
// result, narrowed to exactly the fields any writer reads. `success` is always
// present (a batch statement either ran or it didn't). `error` carries the upstream
// message for the failure path. `meta.changes` is the affected-row count, optional
// because a result that omits it is not evidence of zero rows — recordRemark relies
// on that distinction. Naming only what we consume keeps the type honest about the
// contract rather than importing D1Result's full surface we'd ignore.
export type D1StatementResult = {
  success: boolean
  error?: string
  meta?: { changes?: number }
}

// [LAW:single-enforcer] The sole bridge from drizzle's mistyped batch element to the
// real D1 result shape. `unknown` in (drizzle's static type is not the runtime value),
// `D1StatementResult` out — read `.success` / `.error` / `.meta` typed at the callsite.
export function d1StmtResult(result: unknown): D1StatementResult {
  return result as D1StatementResult
}
