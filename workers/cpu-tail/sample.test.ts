import { describe, expect, it } from 'vitest'
import { CPU_METRIC, WALL_METRIC, samplesForItem } from './sample'
import { toInfluxLine, type LineSample } from './push'

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

const TS = '1700000000000000000'

describe('samplesForItem', () => {
  it('attributes a fetch event to its canonical route + fetch handler', () => {
    const samples = samplesForItem(fetchItem('https://slopspot.ai/p/abc-123', 12, 340), TS)
    expect(samples).toEqual([
      { name: CPU_METRIC, labels: { route: '/p/:id', handler: 'fetch', outcome: 'ok' }, value: 12, timestampNs: TS },
      { name: WALL_METRIC, labels: { route: '/p/:id', handler: 'fetch', outcome: 'ok' }, value: 340, timestampNs: TS },
    ])
  })

  it('attributes a scheduled event to cron:<expr> + scheduled handler', () => {
    const samples = samplesForItem(scheduledItem('* * * * *', 5, 6), TS)
    expect(samples.map((s) => s.labels.route)).toEqual(['cron:* * * * *', 'cron:* * * * *'])
    expect(samples.map((s) => s.labels.handler)).toEqual(['scheduled', 'scheduled'])
  })

  it('carries the runtime outcome through as a label', () => {
    const [cpu] = samplesForItem(fetchItem('https://slopspot.ai/', 99, 99, 'exceededCpu'), TS)
    expect(cpu.labels.outcome).toBe('exceededCpu')
  })

  it('buckets an unknown event variant to the other handler', () => {
    const rpc = { event: { rpcMethod: 'foo' }, cpuTime: 1, wallTime: 2, outcome: 'ok' } as unknown as TraceItem
    expect(samplesForItem(rpc, TS).map((s) => s.labels.handler)).toEqual(['other', 'other'])
  })

  it('drops trace items with a null event (nothing to attribute)', () => {
    const nullEvent = { event: null, cpuTime: 0, wallTime: 0, outcome: 'ok' } as unknown as TraceItem
    expect(samplesForItem(nullEvent, TS)).toEqual([])
  })

  it('canonicalizes an unmatched path to the other route bucket', () => {
    const [cpu] = samplesForItem(fetchItem('https://slopspot.ai/favicon.ico', 1, 1), TS)
    expect(cpu.labels.route).toBe('other')
  })
})

describe('toInfluxLine', () => {
  it('renders name,tags value=<v> <ts> in InfluxDB line protocol', () => {
    const sample: LineSample = {
      name: CPU_METRIC,
      labels: { route: '/p/:id', handler: 'fetch', outcome: 'ok' },
      value: 12.5,
      timestampNs: TS,
    }
    expect(toInfluxLine(sample)).toBe(
      'slopspot_request_cpu_ms,route=/p/:id,handler=fetch,outcome=ok value=12.5 1700000000000000000',
    )
  })

  it('escapes spaces in tag values (cron expressions)', () => {
    const sample: LineSample = {
      name: WALL_METRIC,
      labels: { route: 'cron:* * * * *', handler: 'scheduled', outcome: 'ok' },
      value: 5,
      timestampNs: TS,
    }
    expect(toInfluxLine(sample)).toBe(
      'slopspot_request_wall_ms,route=cron:*_*_*_*_*,handler=scheduled,outcome=ok value=5 1700000000000000000',
    )
  })
})
