import { describe, expect, it } from 'vitest'
import '~/providers' // side-effect: populate the registry so costs are priceable
import { ProviderId } from '~/lib/domain'
import { DAILY_BUDGET_USD, evaluateBudget } from './budget'

const falFlux = ProviderId('fal-flux')
const falFluxMock = ProviderId('fal-flux-mock')

describe('evaluateBudget', () => {
  it('prices calls by the registry per-provider cost, exactly', () => {
    expect(evaluateBudget(new Map([[falFlux, 100]]), DAILY_BUDGET_USD).spentUsd).toBe(0.3)
  })

  it('sums without floating-point drift', () => {
    // 0.003 * 333 is 0.9990000000000001 in float; integer micro-USD makes it exact.
    expect(evaluateBudget(new Map([[falFlux, 333]]), DAILY_BUDGET_USD).spentUsd).toBe(0.999)
  })

  it('treats mock providers as free', () => {
    const status = evaluateBudget(new Map([[falFluxMock, 1000]]), DAILY_BUDGET_USD)
    expect(status.spentUsd).toBe(0)
    expect(status.withinBudget).toBe(true)
  })

  it('denies everything at a $0 ceiling, even a single real call', () => {
    expect(evaluateBudget(new Map([[falFlux, 1]]), 0).withinBudget).toBe(false)
  })

  it('denies at a $0 ceiling with no spend at all', () => {
    expect(evaluateBudget(new Map(), 0).withinBudget).toBe(false)
  })

  it('allows a real call when under the ceiling', () => {
    expect(evaluateBudget(new Map([[falFlux, 1]]), DAILY_BUDGET_USD).withinBudget).toBe(true)
  })

  it('is a hard cap: hitting the ceiling exactly denies the next call', () => {
    expect(evaluateBudget(new Map([[falFlux, 1]]), 0.003).withinBudget).toBe(false)
  })
})
