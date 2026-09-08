// [LAW:verifiable-goals] The infinite-scroll append path (home.tsx → useInfiniteFeed) had NO
// automated regression guard: the Workers vitest pool and the node unit project cannot drive a real
// IntersectionObserver or the turbo-stream Date-revival, so a real bug shipped once — appended pages
// crossed post.createdAt as an ISO STRING (raw fetch, no revival), crashing relativeTime().getTime()
// and wiping the tree (ff1bdb8), caught only by a human in a browser, not by hundreds of green server
// tests. This guard closes that gap: it drives the REAL observer + REAL fetch + REAL Date revival in
// a headless Chromium (vitest browser mode) and asserts the four properties a broken scroll violates —
// (1) the observer fires and pages APPEND, (2) in order with NO dup / NO gap across the page seam,
// (3) the scroll TERMINATES cleanly at nextCursor === null (no infinite spinner), (4) the console
// stays clean (the revival holds — the .getTime() the card crashed on does not throw).
//
// [LAW:behavior-not-structure] It asserts observable scroll behavior, not the hook's internals, so a
// restyle of the wall leaves it green while a genuine append/termination/revival regression turns it red.

import { afterEach, beforeEach, expect, it } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { createElement, type ReactNode } from 'react'
import { useInfiniteFeed } from '~/lib/use-infinite-feed'
import type { FeedItem } from '~/lib/domain'
import type { WireFeedItem } from '~/lib/feed-wire'

// Real browser integration test: state updates are driven by the real observer + real fetch, not by
// act() batching. Tell React so, or it floods console.error with act warnings that would defeat the
// "console clean" assertion (property 4). [LAW:no-silent-failure] the console spy must see only true
// failures, never framework noise.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}
globalThis.IS_REACT_ACT_ENVIRONMENT = false

// A wire row exactly as JSON.parse yields it from /api/feed: post.createdAt is a STRING (Response.json
// serialized the Date). Minimal — the hook reads post.id + revives post.createdAt and passes the rest
// through; the cast names the wire boundary, the same discipline as feed-wire.test.ts.
const CREATED_AT_ISO = '2026-06-04T12:00:00.000Z'
function wireItem(id: string): WireFeedItem {
  return {
    post: {
      id,
      createdAt: CREATED_AT_ISO,
      origin: { kind: 'authored', author: { kind: 'agent', agentId: 'sys:test' } },
      content: { kind: 'found', url: 'https://example.com/x', title: 't' },
    },
    score: 0,
    myVote: 0,
    commentCount: 0,
    viewerIsModifier: false,
    rank: 0,
  } as unknown as WireFeedItem
}

// Page 1 is the loader's SSR result (already a domain FeedItem — createdAt is a real Date). Later
// pages arrive over the wire (strings) and must be revived by the hook.
function domainItem(id: string): FeedItem {
  const w = wireItem(id)
  return { ...w, post: { ...w.post, createdAt: new Date(w.post.createdAt) } } as unknown as FeedItem
}

// The finite cursor chain the stubbed /api/feed serves: c1 → [p3,p4] next c2 → [p5,p6] next null.
// A finite chain terminating in null is the whole point — a broken termination never reaches it.
const PAGES: Record<string, { items: WireFeedItem[]; nextCursor: string | null }> = {
  c1: { items: [wireItem('p3'), wireItem('p4')], nextCursor: 'c2' },
  c2: { items: [wireItem('p5'), wireItem('p6')], nextCursor: null },
}

let realFetch: typeof globalThis.fetch
let realConsoleError: typeof console.error
let consoleErrors: unknown[][]
let windowErrors: string[]
let root: Root | null = null
let host: HTMLElement | null = null

const onWindowError = (e: ErrorEvent) => windowErrors.push(e.message)

beforeEach(() => {
  consoleErrors = []
  windowErrors = []
  realFetch = globalThis.fetch
  realConsoleError = console.error
  console.error = (...args: unknown[]) => { consoleErrors.push(args) }
  window.addEventListener('error', onWindowError)

  // [LAW:effects-at-boundaries] The one seam to the world the hook has is fetch('/api/feed?…'); stub
  // it with the honest wire shape (ISO-string dates) so the guard exercises revival, not a shortcut.
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    const cursor = url.searchParams.get('cursor')
    const body = cursor !== null ? PAGES[cursor] : undefined
    if (body === undefined) throw new Error(`scroll guard: unexpected /api/feed cursor=${cursor}`)
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  }) as typeof globalThis.fetch
})

afterEach(() => {
  root?.unmount()
  root = null
  host?.remove()
  host = null
  globalThis.fetch = realFetch
  console.error = realConsoleError
  window.removeEventListener('error', onWindowError)
})

// The harness renders exactly what the scroll contract touches: the ordered wall (page 1 + appended
// tail), the sentinel the observer watches, and a status line. data-created reads post.createdAt
// .getTime() — the exact call ff1bdb8 crashed on — so a dropped revival throws in render (a string has
// no .getTime), the item never mounts, and the id-order assertion fails: the regression is caught here.
function ScrollHarness({ firstPage, firstCursor, excludeId }: {
  firstPage: FeedItem[]
  firstCursor: string | null
  excludeId: string | null
}) {
  const { extraItems, cursor, loading, sentinelRef } = useInfiniteFeed({
    firstPage,
    firstCursor,
    sort: { mode: 'new' },
    excludeId,
  })
  const items = [...firstPage, ...extraItems]
  return createElement(
    'div',
    null,
    createElement(
      'ul',
      { 'data-testid': 'wall' },
      items.map((it) =>
        createElement(
          'li',
          { key: it.post.id, 'data-post-id': it.post.id, 'data-created': it.post.createdAt.getTime() },
          it.post.id,
        ),
      ),
    ),
    // A 1px sentinel on a short page sits inside the 600px rootMargin from first paint, so the observer
    // fires and the chain auto-advances with no scripted scrolling — deterministic.
    createElement('div', { ref: sentinelRef, 'data-testid': 'sentinel', style: { height: '1px' } }),
    createElement('p', { 'data-testid': 'status' }, loading ? 'loading' : cursor === null ? 'back-wall' : 'more'),
  )
}

function mount(el: HTMLElement, node: ReactNode) {
  host = el
  root = createRoot(el)
  root.render(node)
}

function renderedIds(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('[data-post-id]')).map((n) => n.getAttribute('data-post-id') ?? '')
}

it('drives the real observer through the finite cursor chain: appends in order, no dup/no gap, terminates at null', async () => {
  const el = document.createElement('div')
  document.body.append(el)
  mount(el, createElement(ScrollHarness, {
    firstPage: [domainItem('p1'), domainItem('p2')],
    firstCursor: 'c1',
    excludeId: null,
  }))

  // The observer must FIRE and the chain must run to completion — the status reaching 'back-wall' is
  // clean termination (cursor === null), the property a broken/infinite scroll never satisfies.
  await expect
    .poll(() => el.querySelector('[data-testid="status"]')?.textContent, { timeout: 5000 })
    .toBe('back-wall')

  // Appended in order across the page seam, with no duplicate and no dropped row.
  expect(renderedIds(el)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'])

  // Every rendered createdAt survived .getTime() (revival held) — the numbers are the same instant.
  const created = Array.from(el.querySelectorAll('[data-created]')).map((n) => n.getAttribute('data-created'))
  expect(created).toEqual(new Array(6).fill(String(Date.parse(CREATED_AT_ISO))))

  // Console clean: no render crash, no act noise, no swallowed error. [LAW:no-silent-failure]
  expect(consoleErrors).toEqual([])
  expect(windowErrors).toEqual([])
})

it('extends the page-1 banner exclusion to every appended page (the gilt relic is never also a tile)', async () => {
  const el = document.createElement('div')
  document.body.append(el)
  // p5 is the crowned relic hung in the banner; it arrives in page 2 (c2) and must be filtered out of
  // the appended tail — the same uniform predicate the loader applied to page 1. [LAW:one-source-of-truth]
  mount(el, createElement(ScrollHarness, {
    firstPage: [domainItem('p1')],
    firstCursor: 'c1',
    excludeId: 'p5',
  }))

  await expect
    .poll(() => el.querySelector('[data-testid="status"]')?.textContent, { timeout: 5000 })
    .toBe('back-wall')

  expect(renderedIds(el)).toEqual(['p1', 'p3', 'p4', 'p6'])
  expect(renderedIds(el)).not.toContain('p5')
})

it('a failed feed page halts the scroll loudly — no silent swallow, no unhandled-rejection retry loop', async () => {
  // The one seam to the world returns a 500. [LAW:no-silent-failure] the hook must SURFACE it (console
  // .error) and HALT (cursor → null, the same DATA that ends the scroll), not swallow the rejection and
  // let the observer re-fire into an unbacked-off retry loop. Guards the catch arm the reviewer flagged.
  globalThis.fetch = (async () => new Response('upstream boom', { status: 500 })) as typeof globalThis.fetch
  const el = document.createElement('div')
  document.body.append(el)
  mount(el, createElement(ScrollHarness, { firstPage: [domainItem('p1')], firstCursor: 'c1', excludeId: null }))

  // The scroll ENDS (cursor === null) rather than spinning forever on a broken page.
  await expect
    .poll(() => el.querySelector('[data-testid="status"]')?.textContent, { timeout: 5000 })
    .toBe('back-wall')

  // Page 1 stands; the failed page appended nothing.
  expect(renderedIds(el)).toEqual(['p1'])
  // Loud: the failure reached console.error (not swallowed). [LAW:no-silent-failure]
  expect(consoleErrors.length).toBeGreaterThan(0)
  // The catch arm consumed the rejection — no unhandled promise rejection reached the window.
  expect(windowErrors).toEqual([])
})
