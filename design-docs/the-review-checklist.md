# The Pre-PR Review Checklist

Run this against **your own diff** before you open a PR (and before you trigger any
external review). It exists to catch — at authoring time — the defect *classes* an
automated reviewer would otherwise surface one slow round-trip at a time. Collapsing a
3-round review into 1 is the whole point: the external reviewer should *confirm clean*,
not *discover* what a local pass already knew.

**Why these items and not others:** the findings reviewers raise are predictable classes,
and those classes *are* the architectural laws. So this checklist is just the laws turned
into a review lens. Each item is phrased as a **falsifiable question about your diff** — if
you cannot answer it "yes" with evidence, you have a finding to fix before the PR.

---

1. **Tests assert BEHAVIOR, not structure.** For each new/changed test: *would it FAIL if
   the implementation silently did the wrong thing* — dropped a value before the write,
   returned a stale read, skipped the side effect? A test that only asserts a type's shape
   or a mock's return value proves the mock, not the system. For anything persisted or
   observable, assert a real round-trip (seed → act → read back). `[LAW:behavior-not-structure]`

2. **Boundaries fail loud; nothing is laundered.** At every storage/trust boundary, is a
   forbidden null/absent value *thrown on*, never `!`-asserted and never silently skipped?
   No null guard whose `else` is "do nothing." If a value should never be null, the fix is
   upstream, not a guard. `[LAW:no-defensive-null-guards][LAW:types-are-the-program]`

3. **Exhaustiveness — no swallowing.** Did you add a variant to a closed union? Then every
   switch over it handles the new case *explicitly* (let `tsc -b` find every site). No
   `default:`/wildcard that silently absorbs a new variant. An intentional no-op case is a
   *handled* branch ("host does not execute"), not a missing one. `[LAW:types-are-the-program]`

4. **Leave it smoother — no dead/duplicate.** No stray or duplicate files (two tests for one
   module only if it's a deliberate, documented tier split — pure-unit vs real-runtime), no
   unreferenced code added "for later" without a live consumer this ticket justifies, no
   second copy of a single-enforcer concern (e.g. scattered `Math.random`, a parallel
   picker, a duplicate validator). `[LAW:one-source-of-truth][LAW:single-enforcer]`

5. **Comments explain WHY, never WHAT.** No comment restates what the code does, enumerates
   callers, counts things, or cites line numbers. Delete any stale WHAT-comment you touched.
   If an invariant needs explaining, encode it in the type instead. `[LAW:comments-explain-why-only]`

6. **No silent fallbacks / swallowed errors.** No `2>/dev/null`, `|| true`, `|| echo
   default`, and no fallback that changes the *meaning* of data (a different query, a
   different source). Failures are loud and localizable. `[LAW:no-silent-fallbacks]`

7. **Migrations: numbered, reversible, idempotent.** The migration uses the number the
   orchestrator allocated, has a rollback path, and is idempotent (re-applying yields the
   same state). No dual-write without a documented cutover. `[data-schema]`

8. **Dataflow, not control flow.** Does any new `if` *skip* an operation that should always
   run with varying data? Restructure so the operation always runs and the data (a null, an
   empty list, a discriminated value) decides the outcome. Smell test: if describing your
   design's *mechanics* needs "if / and / when / only / skip," the constraint is probably
   wrong — fix the type, don't branch in the body. `[LAW:dataflow-not-control-flow]`

9. **Self-verify before the PR.** `pnpm typecheck` (all three steps, exit 0) + `pnpm lint`
   clean + `pnpm test` green — locally, before opening the PR. "It probably passes" is a
   finding. `[LAW:verifiable-goals]`

---

**The one line:** every item above is a finding a reviewer *would* raise; raise it on
yourself first. The diff that passes this checklist is the diff whose external review comes
back clean in one round.
