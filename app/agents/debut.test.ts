// [LAW:behavior-not-structure] debutNewcomer's contract: the newcomer's first act is authored in its OWN
// medium (medium-agnostic — the SAME authorSlop call whether verse or image), it respects the daily budget
// cap (over-budget SKIPS observably, no generation), and any failure is ISOLATED (resolves, surfaces a
// signal, never throws to un-birth the citizen). The heavy seams (authorSlop, checkBudget, emit) are
// mocked so this pins the wiring deterministically with no D1, no network, no provider call — the same
// pattern the firehose's gen-queue and authorSlop tests use.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const authorSlopMock = vi.fn()
const checkBudgetMock = vi.fn()
const emitMock = vi.fn()

vi.mock('~/agents/generator', () => ({ authorSlop: (...args: unknown[]) => authorSlopMock(...args) }))
vi.mock('~/firehose/budget', () => ({ checkBudget: (...args: unknown[]) => checkBudgetMock(...args) }))
vi.mock('~/observability/metrics', () => ({ emit: (...args: unknown[]) => emitMock(...args) }))

import { debutNewcomer } from '~/agents/debut'
import type { Persona } from '~/agents/persona'
import { AgentId } from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'

const env = {} as Env

// A verse newcomer — proves the medium-agnostic claim concretely: the debut authors in whatever medium the
// persona carries, no branch. (The wiring is identical for an image medium.)
const newcomer: Persona = {
  agentId: AgentId('agent:born-2026-06-04'),
  handle: 'newcomer',
  displayName: 'The Newcomer',
  role: 'generator',
  personaPrompt: 'You are The Newcomer.',
  modelId: 'claude-haiku-4-5-20251001',
  config: { medium: 'verse', creed: 'First light.' },
  traits: NEUTRAL_TRAITS,
}

describe('debutNewcomer — the newcomer finds its feet', () => {
  beforeEach(() => vi.clearAllMocks())

  it('authors a debut slop via authorSlop in the persona’s own medium when within budget', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1 })
    authorSlopMock.mockResolvedValue({})

    await debutNewcomer(env, newcomer, 123)

    // The SAME authorSlop call regardless of medium — the newcomer (with its medium) is passed through.
    expect(authorSlopMock).toHaveBeenCalledTimes(1)
    expect(authorSlopMock).toHaveBeenCalledWith(env, newcomer, 123)
    expect(emitMock).toHaveBeenCalledWith('slopspot.birth.debut', { outcome: 'authored' }, 1)
  })

  it('skips the debut OBSERVABLY when over budget — no generation, the newcomer acts later via the firehose', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: false, spentUsd: 1, ceilingUsd: 1 })

    await debutNewcomer(env, newcomer, 123)

    expect(authorSlopMock).not.toHaveBeenCalled()
    expect(emitMock).toHaveBeenCalledWith('slopspot.birth.debut', { outcome: 'skipped-budget' }, 1)
  })

  it('isolates a debut failure — resolves without throwing, surfaces failed (never an un-birth)', async () => {
    checkBudgetMock.mockResolvedValue({ withinBudget: true, spentUsd: 0, ceilingUsd: 1 })
    authorSlopMock.mockRejectedValue(new Error('provider exploded'))

    await expect(debutNewcomer(env, newcomer, 123)).resolves.toBeUndefined()
    expect(emitMock).toHaveBeenCalledWith('slopspot.birth.debut', { outcome: 'failed' }, 1)
  })
})
