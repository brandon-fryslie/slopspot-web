# The Pipeline — serial ticket dispatch  **[PROVISIONAL — WIP, DO NOT PROMOTE]**

> **Status: provisional working notes, not a hard invariant.** This is living
> documentation of an *unvalidated* process. Load it as markdown; do **not** run it
> as an auto-discovered skill. It earns promotion to `.claude/skills/dispatch-ticket/`
> only after ≥1 real run validates the choreography. Until then: read it, follow it,
> and **edit it as the first run teaches us where the seams actually are.**

## What this is

A **serial, no-fanout** loop in which the **orchestrator** session (the one that
owns git + grooming + this doc) drives a single **implementer** session through
tickets from `lit ready`, one at a time, gating every result before it reaches
master.

**Why serial, not parallel:** the implement→verify→PR→review→merge loop is proven.
The risk is *fanout* — N concurrent sessions multiply divergence and remove the
supervisor from the divergence path. Serial keeps the orchestrator able to inspect
each result and correct course before the next ticket starts.
`[LAW: scripting-discipline — amplifiers]` the amplifier is concurrency, not the loop.

## Roles (one concern each — `[LAW:single-enforcer]`)

- **CD** owns design-doc *content* (in the working tree).
- **Orchestrator (me)** owns *process*: groom + rank `lit`, commit docs as quick PRs,
  dispatch tickets, **verify artifacts, merge, sequence.** The *only* thing that
  reaches master.
- **Implementer session** owns *one ticket at a time*: implement → PR → green review →
  **stop**. It never merges and never self-sequences.

## Topology decision (locked for v1)

- **One persistent implementer session, handed in already running.** No fanout ⇒
  never >1 branch in flight ⇒ one session suffices.
- **The implementer provisions its OWN worktrees.** The orchestrator does NOT run
  `git worktree add` for it and there is no human launch handoff — the session is
  already alive in its pane and the dispatch prompt tells it to cut its own
  worktree/branch per ticket. `[LAW:single-enforcer]` the session owns its own
  working-copy lifecycle; the orchestrator owns only dispatch + gate + merge.
- The skill operates on a **handed-in running session** (same contract as `tmux-talk`).
- Cross-pane messaging is **`tmux-talk`** — NOT `message-in-a-bottle` (which is
  correctly self-only; `[LAW:one-source-of-truth]` derives its target from `$TMUX_PANE`
  and we keep it pristine).

## Setup

No orchestrator-side setup. The implementer session is handed in running (currently
`slopspot-web:5.1`). Confirm it's idle (`tmux-talk idle <pane>`) and dispatch.

## The loop (one iteration)

`TALK=~/.claude/skills/tmux-talk/bin/tmux-talk` · `TARGET=slopspot-web:5.1`

0. **Pick** — `lit ready`, take the top *unblocked* item. Never hand-pick; the
   dependency graph is the scheduler (`[LAW:dataflow-not-control-flow]`). Re-check
   after every merge — a merge can unblock dependents.
1. **Claim** — `lit start <id>` so the backlog shows it in-flight.
2. **Dispatch** — `$TALK idle "$TARGET"` first, then `$TALK send "$TARGET"` a ONE-LINE
   delta-prompt (CLAUDE.md already gave it the laws + architecture). The delta carries:
   - `Implement lit ticket <id>. Run \`lit show <id>\` for the spec.`
   - **the RECONCILE locks verbatim** if the ticket touches one (persona==Actor;
     ONE composer; provider==persona.medium).
   - **machine-verifiable acceptance criteria.**
   - the **standing rules** (below).
   Multi-line messages submit early in a Claude TUI — collapse to ONE line.
3. **Monitor** — `$TALK wait "$TARGET"` then `read-screen`. Watch for divergence:
   inventing a parallel model (the locks!), editing outside ticket scope, claiming
   done with no PR, or stalling on a prompt.
4. **GATE (orchestrator)** — read the actual PR diff + checks; verify acceptance
   behaviorally as the work warrants. If diverged → correct via `$TALK send` and
   re-gate. *This is the entire point of serial: catch it before it's a mess.*
5. **Merge (orchestrator only)** — `gh pr merge --squash --delete-branch`, then
   `lit done <id>` (two-phase: capture the preview token, rerun `--apply=<token>`).
6. **Re-dispatch** — `$TALK send "$TARGET" "/clear"`, wait idle, then go to 0 with the
   next ticket. `/clear` gives the session a fresh context; it stays in the same
   worktree and cuts a new branch off master for the next ticket.

## Standing rules embedded in every dispatch prompt

> ORCHESTRATED SESSION. Do ONLY ticket <id>. Provision your OWN worktree off fresh
> master: `git fetch origin && git worktree add .claude/worktrees/<id> -b <id> origin/master`
> and `cd` into it. Build per the CLAUDE.md laws; verify
> behaviorally. **Before opening the PR, run the pre-PR review checklist at
> `design-docs/the-review-checklist.md` against your own diff and self-correct every
> finding** — this is what makes the external review confirm clean in one round instead
> of discovering findings round by round. Then open a PR and run `/address-pr-reviews`
> until the Copilot review is clean — then **STOP at its clean-review EXIT. Do NOT
> execute the skill's Finalize section** (it merges, closes the lit ticket, runs `/recap`, and fires
> `message-in-a-bottle` — none of that applies to you). Your only terminal action is to
> reply `PR READY: <url>` to the orchestrator pane, then go idle and pick up nothing.
> The orchestrator owns merge + deploy + ticket-close + sequencing.

**This override must name the Finalize SECTION explicitly — "don't merge" alone is not
enough.** Run #2 showed a worker that had internalized "don't merge" still announce it was
about to *"Finalize (merge → close ticket → recap → handoff)"* — because `/address-pr-reviews`'s
Finalize is a strong built-in attractor and the worker was faithfully following the skill.
`[LAW:one-source-of-truth]` two authorities for "who merges" (the skill's Finalize vs. the
dispatch override) only resolves if the dispatch *re-asserts* the override against the named
section. Catch this by **reading the worker's screen on its stall, not just waiting for the
PR-READY reply** — the drift is visible in its stated plan *before* it acts, and an idle worker
can be corrected with one `tmux-talk send` that lands as a fresh turn before the merge step.

## Dependency discipline

`foundation.1` (persona == Actor) is the **keystone** — it alone unblocks
`back-door-ndr.3`, `roll-call.1`, `roll-call.2`. It goes first, alone. Only dispatch
from `lit ready`.

## Lessons from run #1 (foundation.1 — the keystone, MERGED 90e351a)

The four launch questions, now answered by a real run — plus what the run taught.

1. **PR-ready signal — RESOLVED (and the watcher refined to idle-stall-only).** The
   implementer's `PR READY: <url>` sent via `tmux-talk send` to the orchestrator pane
   wakes the orchestrator reliably (it lands as a user turn) — *that reply is the single
   source of the PR-ready signal.* Do **not** also grep the implementer's screen for the
   sentinel: it false-matches the dispatch's own echoed instruction ("report the PR URL
   prefixed `PR READY: <url>`") AND it false-matches the *previous* ticket's sentinel
   still in scrollback after a `/clear`. `[LAW:one-source-of-truth]` the tmux reply is
   the signal; the screen is not a second source. The `Monitor` watcher's only job is the
   orthogonal concern — detect a **stall** (implementer wedged on a prompt / dead session,
   no progress) so the orchestrator doesn't wait forever. Arm it **idle-stall-only**:
   count consecutive `tmux-talk idle` hits (≥5 ≈ 100s) and emit once, never content-match.
2. **Stop-at-green vs let-it-merge — RESOLVED.** "Open a PR, run `/address-pr-reviews`
   until Copilot is clean, then STOP and report, do NOT merge" works cleanly: the
   session ran the review loop, held at green, and the orchestrator merged. No fight
   with the skill's Finalize — the standing rule overrides it *for the orchestrated
   session*, and that override sticks because it's stated in the dispatch.
3. **`/clear` re-dispatch — RESOLVED, with a sharp gotcha.** `/clear` (and ANY slash
   command, and anything position-sensitive) MUST go via **raw `tmux send-keys`**, never
   `tmux-talk send`. `tmux-talk send` wraps every message in a `From:/To-reply:`
   envelope, so a `/clear` lands as inert text (a slash command only fires at the start
   of the input). Correct sequence: `send-keys C-u` (clear any pending box text) →
   `send-keys "/clear"` → (1s) `send-keys Enter`. A `/clear`'d session comes back fresh,
   re-reads CLAUDE.md, and provisions a new worktree off updated master cleanly.
4. **Divergence / spec-correction — RESOLVED.** A `tmux-talk send` amendment mid-flight
   is the cheap fix: the implementer's CitizenRef spec was corrected *live* (it queued
   the message and incorporated it) before it finished — no abort, no re-dispatch.
   Reserve abort+re-dispatch for a session that has gone structurally off the rails.

**NEW — the multi-lens gate earns its cost on keystone-class PRs.** Three *different-lens*
reviewers each caught a defect class invisible to the others: the orchestrator type-gate
(locks), the CD's creative/vision lens (a name→serial regression that COMPILES and PASSES
TESTS — invisible to correctness review), and an independent adversarial-correctness lens
(two migration scope-boundary crossings + cold behavioral verification). Three *aligned*
reviewers share blind spots; three *different-lens* ones don't. Reserve the adversarial
pass for high-stakes / hard-to-reverse changes — a second session as a **reviewer, not a
parallel writer** (zero fanout). Fanout on routine tickets just dulls the signal.

**NEW — doc-PR sequencing is a one-source-of-truth constraint.** A docs PR that a future
ticket's implementer will read *from master* must merge BEFORE that ticket dispatches
(e.g. the voice-layer-contract PR before `foundation.7`). Otherwise master's doc is the
stale version while the ticket carries the wired contract — a divergence between the
doc-layer and ticket-layer representations of the same truth.

**NEW — cross-references live at the ticket layer.** Implementation pointers (exact stub
shapes, "surface X consumes doc Y") go in the lit tickets (the work source-of-truth);
design docs stay vision-level and are NOT mirrored with every ticket pointer. Keeps the
docs stable and the tickets authoritative.

## Lessons from run #2 (two impl lanes + a dedicated reviewer)

The user opted into **bounded parallel** — two implementer sessions plus a third as
the standing adversarial reviewer — to keep both build lanes fed. This is no longer
strict no-fanout, but the fanout is *bounded and supervised*: the orchestrator still
gates and merges every PR serially, so it remains on the divergence path. `[LAW:scripting-discipline — amplifiers]`
the cap (2) is the control; the orchestrator-as-single-merge-enforcer is the safety.

1. **Logical independence ≠ file independence — pair by DISJOINT FILES.** Tickets marked
   "independent / parallel" are logically independent, but several touch the same hot
   files (`domain.ts`, `feed.ts`, `posts.ts`). Two branches editing the same hot file =
   guaranteed merge fight. To run two lanes, pair tickets whose file sets are disjoint
   (e.g. a storage ticket on `domain/posts/feed` alongside a persona-`seam` ticket on
   `persona.ts`). Maintain a hot-file ledger per ready ticket so pairing is mechanical.
   `[LAW:locality-or-seam]` the disjointness *is* the seam between lanes.
2. **Allocate migration numbers explicitly per dispatch.** Two parallel branches each cut
   "the next migration" and both grab `00NN`; the second-merged is duplicate/misordered.
   The orchestrator owns a migration-number ledger and pins the number in each dispatch
   prompt (`you are allocated 0018, name it 0018_x.sql`). `[LAW:one-source-of-truth]` the
   ledger is the single authority for the migration sequence across concurrent branches.
3. **Serialize the hot-file trio.** When N>2 tickets all touch the same hot file
   (`feed.ts`/`domain.ts`), they collide with *each other*, not just with the in-flight
   storage ticket — never run two of them at once regardless of logical independence.
4. **Keep the reviewer a reviewer.** With three identical agents it's tempting to make all
   three implementers for max throughput. Don't — keystone-class PRs (domain-type / schema /
   migration / cross-service-contract) need the third *different-lens* (adversarial) pass
   that run #1 proved catches defect classes the type-gate and vision-gate miss. Two build
   lanes + one reviewer beats three build lanes whose keystone PRs ship un-adversaried.

## Lessons from run #3 (actually pipelining — kill the barrier)

The serial loop (gate → merge → *then* re-dispatch) leaves the worker **idle through the
entire gate+adversarial+merge+deploy phase**. That's a barrier where a pipeline belongs:
building ticket N+1 does not depend on *merging* N. Same insight as `pipeline()` vs a
`parallel()` barrier — don't synchronize stages that have no real dependency.

**The rule:** on a lane's `PR READY`, the moment a disjoint+independent+ready ticket
exists, `/clear` + dispatch it **immediately**; gate+merge+deploy the finished PR
**asynchronously**, in parallel with the worker's next build. The orchestrator is one
consumer gating serially and fast; as long as gate-throughput ≥ build-rate, nothing
stalls and no two un-gated PRs stack. `[LAW:dataflow-not-control-flow]` the worker is a
producer that never blocks on the consumer.

- **Disjointness now spans every OPEN branch**, not just the two in-flight lanes: ticket
  N+1 must be file-disjoint from (a) the other lane's current ticket AND (b) this lane's
  own still-open-unmerged PR (N), because N+1 branches off a master that lacks N. The
  migration-number ledger likewise covers every open allocation.
- **Rare-hole recovery:** if the async gate finds holes in N after the worker moved to
  N+1, the fix is a follow-up task (the worktree persists; the worker circles back, or a
  trivial fix is made directly). Acceptable because the checklist + Copilot + type-gate
  make post-gate holes rare. The throughput win dominates.

**The dependency graph is the real throughput ceiling — groom for independent STREAMS.**
A narrow chain (everything funnels through one keystone substrate, e.g. `.3` the wish
store) cannot parallelize no matter how good the pipeline: consumers have a true data
dependency on the unmerged field, and siblings collide on its open branch's files. Two
responses: (1) **prioritize merging the chokepoint** — it is what *opens* the parallel
streams; (2) **keep an independent filler ready** (a disjoint chore — dead-code removal,
a missing test) so a lane that would otherwise idle on the chain stays warm. Idle is a
grooming signal: it means the ready queue lacks a stream disjoint from what's in flight.

## Lessons from run #4 (the deploy path is a single-writer resource)

**Deploys MUST serialize — never two `pnpm run deploy` concurrently.** `pnpm run deploy`
is `react-router build && wrangler deploy`; the build writes a shared `build/` dir. Running
two in parallel (e.g. backgrounding a `.1.2` deploy, then backgrounding a `.11` deploy
before the first finished) has two writers racing one artifact dir — corrupt-bundle risk,
and the deploys race on which version wins. `[LAW:single-enforcer]` `build/` has one
writer-slot; the orchestrator is its serializer. `[LAW:scripting-discipline — amplifiers]`
backgrounding hid the unsafe concurrency. **Rule:** at most one deploy in flight; if merges
land close together, either batch them into one deploy or run the deploys strictly back to
back. When in doubt after any deploy-path anomaly, run **one final serialized deploy from
master** — last-successful-deploy-from-master wins, so a single clean run guarantees
prod == master regardless of prior races. (This is distinct from the lanes, which parallelize
fine — only the deploy/build artifact is the contended single-writer resource.)

## Lessons from run #5 (match the model tier to the task shape)

Topology now: **three Opus impl lanes + one dedicated Sonnet reviewer + CD (vision) +
orchestrator.** The reviewer moved to a faster model on purpose — review is a
*read-and-verdict* task (bounded input, short output: "read the diff, try to refute,
return GO/HOLES"), not long generative design, so a faster/cheaper tier carries it with
much lower latency and no quality loss; gate quality is a function of coverage and
skepticism, not the deepest model. The hard generative work (constraint design, building
to the laws) stays on the deepest tier in the impl lanes. **Heuristic:** put the fast
model where the work is *evaluative/bounded* (review, classification, lint-shaped checks),
the deep model where it is *generative/open* (design, implementation). With review latency
collapsed, the adversarial lens is effectively free — so every keystone PR gets it, and it
no longer trades off against throughput. All adversarial passes route to the reviewer pane
(reply to the orchestrator); CD remains the separate creative/vision lens; the orchestrator
remains the single type-gate + merge enforcer.

## Lessons from run #6 (one question per review lens — keep CD at altitude)

Sharpen each review lens to a single concern (`[LAW:single-enforcer]` for review):
- **CD = the VISION lens, only.** Does it honor the soul; does a citizen read as a
  citizen (not plumbing); does the voice land in register; does it FEEL like the city.
  CD reads the **real artifact** (rendered copy, persona prose, the diff's voice/UX parts —
  never the orchestrator's summary; reading the real thing is how the catches happen) but
  stays at altitude: ideas and taste, not the weeds.
- **Orchestrator + implementer + correctness-reviewer = STRUCTURAL.** Dependency edges,
  migrations, table rebuilds, compile, the type-gate. CD does **not** re-verify SQL or edges.
- **Dispatch discipline:** when routing a review to CD, surface ONLY the vision-relevant
  artifact and ask ONLY the vision question. If you're about to ask CD a *structural*
  question, that one is yours to answer — never hand it up.

Why it works: the lens that owns "does this read as a citizen" catches a class invisible to
correctness review — e.g. a creed string-sliced from prose reads as a name-prefixed bio, not
a creed: it compiles, passes tests, and the type-gate is green, yet it's *wrong as a citizen
asset*. Only the vision lens, reading the rendered artifact, sees it. Keeping CD un-burdened
by the weeds is what keeps that lens sharp.

## Lessons from run #7 (you cannot defer a migration that's on master)

`wrangler d1 migrations apply` applies **every pending migration**, not the one you have
in mind. So a migration that is **merged to master but intended to be held** (e.g. gated
behind a cross-service redeploy) is *not actually deferred* — the next `migrations apply`
for *any* later migration sweeps it up. This bit a real cross-service break: a creed
migration that wrote keys onto homelab-`.strict()`-parsed configs got swept in alongside an
unrelated migration, before the homelab containers were redeployed to accept the new key.
Caught in minutes and rolled back via the migration's own documented `json_remove` clause
(homelab unbroken, at most one missed periodic pass), but the root cause is procedural:

- **To genuinely defer a migration, do NOT merge it to master until the gating step is done.**
  Keep it on its branch, or split the PR so the migration lands separately when ready.
  "Merge now, hold the apply" is a false sense of safety — the apply is not per-file.
- **Every migration MUST carry a documented rollback clause** (this one's `json_remove` is
  what made recovery a one-liner). The `data-schema` law earns its keep here.
- **Cross-service schema changes have deploy ordering** (`single-enforcer` across services):
  if a migration writes data a *separately-deployed* consumer parses with `.strict()`, the
  consumer must ship the widened schema **before** the migration applies — and since you
  can't hold a merged migration, that means **don't merge the migration until the consumer
  is deployed.**
- **After applying any migration, check what actually applied** (the apply output lists every
  file it ran) — don't assume it was only the one you intended.

## Lessons from run #8 (panes get blocked by Claude Code UI dialogs)

A pane can stall not because the agent is wedged but because a **Claude Code interactive
dialog is holding its input** — most commonly the periodic "How is Claude doing this
session? 1/2/3/0" feedback prompt. It hit CD (stalled a review verdict → stalled a merge →
idled a lane) and later an implementer (stalled a PR-ready report). Symptoms: the pane is
`idle` (no spinner) but unresponsive to messages, and `read-screen` shows the dialog.
**Recovery:** dismiss it with a raw `tmux send-keys <pane> "0"` (the Dismiss option), then
the queued/next message processes. **Diagnosis discipline:** when a pane is unexpectedly
idle past its normal cadence, `read-screen` it *before* assuming the agent died — it may be
a modal, a rate-limit-killed turn (idle at the prompt, needs a nudge to resume), or a usage
cap (the status line shows the limit). Three different idle causes, three different fixes:
modal→dismiss, killed-turn→nudge, cap→park the lane. The backstop watcher's job is just to
*prompt the look*; the screen tells you which.

## Explicitly OUT of scope for v1 (reserve)

- Parallel fanout (the risk — excluded on purpose).
- Auto-launching claude sessions.
- Promotion to an auto-discovered skill (only after a validated run).
