import { describe, expect, it } from 'vitest'
import {
  CPU_BUCKETS_MS,
  CPU_METRIC,
  WALL_METRIC,
  deltasForItem,
  histogramDeltas,
} from './sample'
import { mergeDeltas } from './index'

// Minimal TraceItem fixtures. We only populate the fields the mapper reads, then cast —
// the real runtime object has many more readonly fields irrelevant to attribution.
const fetchItem = (url: string, cpu: number, wall: number, outcome = 'ok') =>
  ({
    event: { request: { url } },
    cpuTime: cpu,
    wallTime: wall,
    outcome,
  }) as unknown as TraceItem

const scheduledItem = (cron: string, cpu: number, wall: number) =>
  ({
    event: { cron, scheduledTime: 0 },
    cpuTime: cpu,
    wallTime: wall,
    outcome: 'ok',
  }) as unknown as TraceItem

const LABELS = { route: '/p/:id', handler: 'fetch', outcome: 'ok' }

describe('histogramDeltas', () => {
  it('emits +1 on every cumulative bucket covering the value, plus +Inf, sum, count', () => {
    const deltas = histogramDeltas('m', LABELS, 12, [1, 10, 25, 100])
    expect(deltas).toEqual([
      { name: 'm_bucket', labels: { ...LABELS, le: '25' }, value: 1 },
      { name: 'm_bucket', labels: { ...LABELS, le: '100' }, value: 1 },
      { name: 'm_bucket', labels: { ...LABELS, le: '+Inf' }, value: 1 },
      { name: 'm_sum', labels: LABELS, value: 12 },
      { name: 'm_count', labels: LABELS, value: 1 },
    ])
  })

  it('counts a value equal to a bucket bound inside that bucket (le is inclusive)', () => {
    const deltas = histogramDeltas('m', LABELS, 10, [1, 10, 25])
    expect(deltas.filter((d) => d.name === 'm_bucket').map((d) => d.labels.le)).toEqual([
      '10',
      '25',
      '+Inf',
    ])
  })

  it('lands an over-range value only in +Inf', () => {
    const deltas = histogramDeltas('m', LABELS, 9999, [1, 10])
    expect(deltas.filter((d) => d.name === 'm_bucket').map((d) => d.labels.le)).toEqual(['+Inf'])
  })
})

describe('deltasForItem', () => {
  it('attributes a fetch event to its canonical route + fetch handler', () => {
    const deltas = deltasForItem(fetchItem('https://slopspot.ai/p/abc-123', 12, 340))
    const cpuSum = deltas.find((d) => d.name === `${CPU_METRIC}_sum`)
    const wallSum = deltas.find((d) => d.name === `${WALL_METRIC}_sum`)
    expect(cpuSum).toEqual({ name: `${CPU_METRIC}_sum`, labels: LABELS, value: 12 })
    expect(wallSum).toEqual({ name: `${WALL_METRIC}_sum`, labels: LABELS, value: 340 })
  })

  it('attributes a scheduled event to cron:<expr> + scheduled handler', () => {
    const deltas = deltasForItem(scheduledItem('* * * * *', 5, 6))
    for (const d of deltas) {
      expect(d.labels.route).toBe('cron:* * * * *')
      expect(d.labels.handler).toBe('scheduled')
    }
  })

  it('carries the runtime outcome through as a label', () => {
    const [first] = deltasForItem(fetchItem('https://slopspot.ai/', 99, 99, 'exceededCpu'))
    expect(first.labels.outcome).toBe('exceededCpu')
  })

  it('buckets an unknown event variant to the other handler', () => {
    const rpc = {
      event: { rpcMethod: 'foo' },
      cpuTime: 1,
      wallTime: 2,
      outcome: 'ok',
    } as unknown as TraceItem
    const deltas = deltasForItem(rpc)
    expect(deltas.length).toBeGreaterThan(0)
    for (const d of deltas) expect(d.labels.handler).toBe('other')
  })

  it('drops trace items with a null event (nothing to attribute)', () => {
    const nullEvent = { event: null, cpuTime: 0, wallTime: 0, outcome: 'ok' } as unknown as TraceItem
    expect(deltasForItem(nullEvent)).toEqual([])
  })

  it('canonicalizes an unmatched path to the other route bucket', () => {
    const [first] = deltasForItem(fetchItem('https://slopspot.ai/favicon.ico', 1, 1))
    expect(first.labels.route).toBe('other')
  })
})

describe('mergeDeltas', () => {
  it('folds same-series deltas from many items into one entry per (name, labels)', () => {
    const items = [
      fetchItem('https://slopspot.ai/p/aaa', 3, 10),
      fetchItem('https://slopspot.ai/p/bbb', 12, 20),
    ]
    const merged = mergeDeltas(items.flatMap(deltasForItem))
    const count = merged.find((d) => d.name === `${CPU_METRIC}_count`)
    const sum = merged.find((d) => d.name === `${CPU_METRIC}_sum`)
    const inf = merged.find((d) => d.name === `${CPU_METRIC}_bucket` && d.labels.le === '+Inf')
    // cpu=3 covers le>=5; cpu=12 covers le>=25 — le=25 holds both, le=5 only one.
    const le25 = merged.find((d) => d.name === `${CPU_METRIC}_bucket` && d.labels.le === '25')
    const le5 = merged.find((d) => d.name === `${CPU_METRIC}_bucket` && d.labels.le === '5')
    expect(count?.value).toBe(2)
    expect(sum?.value).toBe(15)
    expect(inf?.value).toBe(2)
    expect(le25?.value).toBe(2)
    expect(le5?.value).toBe(1)
    // The merged batch has exactly one entry per distinct (name, labels) pair.
    expect(CPU_BUCKETS_MS.length).toBe(10)
    const keys = merged.map((d) => `${d.name};${JSON.stringify(d.labels)}`)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
