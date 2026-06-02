// [LAW:single-enforcer] The Cast self-portraits (roll-call-47p.6). A citizen's
// avatar IS an example of its own work — rendered in the citizen's own medium
// (well-foundation F1). This module owns the two acts that touch a portrait: one
// (re)render, and the scheduled drift pass that decides who is due. Generation is
// NOT re-implemented here: a self-portrait is just a persona authoring a slop OF
// ITSELF, so it reuses the one authoring path the firehose and the Well already
// take and adds nothing to the generation plumbing. The only new datum is the
// write-back of the resulting asset onto the citizen's config.
//
// [LAW:dataflow-not-control-flow] WHO renders is data, not a per-citizen branch: a
// citizen is due iff it has a medium (so it CAN render in its own hand) and its
// portrait directive is neither `declined` (the Proprietor) nor `refused` (the
// Gremlin) and its current face has drifted past the window. The Proprietor and the
// Gremlin fall out of the target set BY THEIR DATA — no name is checked here.
//
// [LAW:one-source-of-truth] The portrait reference lives on the persona's config
// (`config.portrait`), parsed by lib/portrait — the same datum the card and the
// Cast read. The pass WRITES it; the surfaces READ it; there is one home.

import type { Persona } from '~/agents/persona'
import { listAllPersonas, updatePersonaConfig } from '~/agents/persona'
import { authorSlop } from '~/agents/generator'
import { checkBudget } from '~/firehose/budget'
import { emit } from '~/observability/metrics'
import { portraitStateOf } from '~/lib/portrait'
import type { Post } from '~/lib/domain'

// Faces drift weekly. A citizen rendered less than a window ago is a settled face;
// past it, the next pass re-renders — "a population whose faces are never quite
// settled" (the-roll-call.md), and a bounded, staggered spend (a few makers, once a
// week each). Initial fill happens on the first pass: every eligible citizen reads
// as `unrendered` and so is due at once.
export const PORTRAIT_DRIFT_MS = 7 * 24 * 60 * 60 * 1000

// [LAW:one-source-of-truth] The one reader of "this citizen's portrait medium" — the
// provider it is depicted in. It IS `config.medium` (F1/item 9: a persona's medium is
// the provider it works in; a self-portrait renders in that same hand). A citizen
// without a medium (every critic/scavenger/host today) cannot have a self-portrait by
// construction, so it drops out of the target set rather than promising a face that
// never comes. Lighting such a citizen up is a one-row data change (give it a medium),
// no code edit — the engine is medium-driven, not role-driven.
export function portraitMediumOf(config: Record<string, unknown>): string | null {
  const medium = config.medium
  return typeof medium === 'string' && medium.trim() !== '' ? medium : null
}

// [LAW:dataflow-not-control-flow] Pure: (roster, clock) → who is due. The exhaustive
// switch over the portrait state makes the Proprietor (`declined`) and the Gremlin
// (`refused`) first-class NON-targets — they are excluded by the shape of their data,
// and a new portrait state would force a decision here before it compiles.
export function selectPortraitTargets(
  personas: Persona[],
  nowMs: number,
  driftMs: number = PORTRAIT_DRIFT_MS,
): Persona[] {
  return personas.filter((persona) => {
    // A self-portrait renders in the citizen's OWN medium; no medium, no render.
    if (portraitMediumOf(persona.config) === null) return false
    const state = portraitStateOf(persona.config)
    switch (state.kind) {
      case 'declined':
      case 'refused':
        return false
      case 'unrendered':
        return true
      case 'rendered':
        return nowMs - state.renderedAt >= driftMs
      default: {
        const _exhaustive: never = state
        return _exhaustive
      }
    }
  })
}

// [LAW:single-enforcer] One (re)render: author a self-portrait through the single
// authoring path and write the resulting asset onto the citizen's config. The persona
// must have a medium (the caller selects only medium-having citizens); the authoring
// path owns the medium resolution, prod-mock guard, recipe, and voice-steered
// composition.
//
// That path returns a succeeded image generation by construction — a provider failure
// throws (leaving the failed slop row observable) and a non-image return throws — so a
// returned post always carries a usable url. A post that somehow is not one is a broken
// invariant: fail loud, never write a portrait pointing at nothing.
export async function renderSelfPortrait(env: Env, persona: Persona, nowMs: number): Promise<string> {
  const post = await authorSlop(env, persona, nowMs, { kind: 'self-portrait' })
  const url = portraitUrlOf(post)
  // [LAW:one-source-of-truth] Write the reference beside the rest of the citizen's
  // config — the whole blob is re-serialised on write, so a spread preserves the
  // medium, biases, voice, and creed. renderedAt stamps the face for the drift scheduler.
  await updatePersonaConfig(env, persona.agentId, {
    ...persona.config,
    portrait: { url, renderedAt: nowMs },
  })
  return url
}

function portraitUrlOf(post: Post): string {
  const content = post.content
  if (
    content.kind === 'generation' &&
    content.status.kind === 'succeeded' &&
    content.status.output.kind === 'image'
  ) {
    return content.status.output.url
  }
  throw new Error(
    `renderSelfPortrait: authored portrait ${post.id} is not a succeeded image generation`,
  )
}

// [LAW:single-enforcer] The scheduled drift pass — folded into the existing daily
// cron, NOT a parallel scheduler. Regenerates every due citizen, gated by the one
// spend authority the firehose shares. An empty target set is the no-op pass (zero
// iterations) — the ~6-of-7-days case once faces settle — and it returns before
// touching the budget query, mirroring the firehose tick.
export async function runPortraitPass(env: Env, nowMs: number): Promise<void> {
  const targets = selectPortraitTargets(await listAllPersonas(env), nowMs)
  if (targets.length === 0) return

  const budget = await checkBudget(env)
  if (!budget.withinBudget) {
    console.log('portrait.pass: over budget; skipping', {
      spentUsd: budget.spentUsd,
      ceilingUsd: budget.ceilingUsd,
      due: targets.length,
    })
    for (const persona of targets) {
      emit('slopspot.portrait.render', { agent_id: persona.agentId, outcome: 'skipped-budget' }, 1)
    }
    return
  }

  // [LAW:dataflow-not-control-flow] Sequential per target — same discipline the
  // firehose uses: each render commits a generation row before the next reads recent
  // recipes. A failed render must not abort the rest of the pass, so each is caught,
  // logged, and counted; the failed slop row remains observable.
  for (const persona of targets) {
    try {
      const url = await renderSelfPortrait(env, persona, nowMs)
      console.log('portrait.pass: rendered', {
        agentId: persona.agentId,
        handle: persona.handle,
        displayName: persona.displayName,
        url,
      })
      emit('slopspot.portrait.render', { agent_id: persona.agentId, outcome: 'rendered' }, 1)
    } catch (err) {
      console.error(
        'portrait.pass: render failed',
        { agentId: persona.agentId, handle: persona.handle },
        err,
      )
      emit('slopspot.portrait.render', { agent_id: persona.agentId, outcome: 'failed' }, 1)
    }
  }
}
