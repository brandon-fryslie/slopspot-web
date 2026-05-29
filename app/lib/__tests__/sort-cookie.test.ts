import { describe, expect, it } from 'vitest'
import {
  readSortCookie,
  readSortCookieRaw,
  serializeSortCookie,
} from '~/lib/sort-cookie'
import { defaultSortMode, parseSortMode, serializeSortMode, type SortMode } from '~/lib/sort-mode'

function makeRequest(cookieValue?: string): Request {
  const headers: Record<string, string> = {}
  if (cookieValue !== undefined) headers['Cookie'] = `slopspot_sort=${cookieValue}`
  return new Request('https://slopspot.ai/', { headers })
}

describe('app/lib/sort-cookie.ts', () => {
  describe('readSortCookie', () => {
    it('returns null when no cookie header', () => {
      expect(readSortCookie(new Request('https://slopspot.ai/'))).toBeNull()
    })

    it('returns null for unknown sort value', () => {
      expect(readSortCookie(makeRequest('garbage'))).toBeNull()
    })

    it('parses "new" cookie', () => {
      expect(readSortCookie(makeRequest('new'))).toEqual({ mode: 'new' })
    })

    it('parses "top" cookie', () => {
      expect(readSortCookie(makeRequest('top'))).toEqual({ mode: 'top', window: 'all' })
    })

    it('parses "top/day" cookie (slash form)', () => {
      expect(readSortCookie(makeRequest('top/day'))).toEqual({ mode: 'top', window: 'day' })
    })

    it('parses "top/week" cookie (slash form)', () => {
      expect(readSortCookie(makeRequest('top/week'))).toEqual({ mode: 'top', window: 'week' })
    })

    it('ignores unrelated cookies and reads slopspot_sort', () => {
      const req = new Request('https://slopspot.ai/', {
        headers: { Cookie: 'other=x; slopspot_sort=new; third=y' },
      })
      expect(readSortCookie(req)).toEqual({ mode: 'new' })
    })
  })

  describe('readSortCookieRaw', () => {
    it('returns null when absent', () => {
      expect(readSortCookieRaw(new Request('https://slopspot.ai/'))).toBeNull()
    })

    it('returns the raw string for a known value', () => {
      expect(readSortCookieRaw(makeRequest('new'))).toBe('new')
    })

    it('returns the raw string even for an unknown value', () => {
      expect(readSortCookieRaw(makeRequest('garbage'))).toBe('garbage')
    })
  })

  describe('serializeSortCookie round-trip', () => {
    const modes: SortMode[] = [
      defaultSortMode,
      { mode: 'new' },
      { mode: 'top', window: 'day' },
      { mode: 'top', window: 'week' },
    ]
    for (const mode of modes) {
      it(`round-trips ${serializeSortMode(mode)}`, () => {
        const header = serializeSortCookie(mode, false)
        const value = header.split(';')[0].split('=').slice(1).join('=')
        expect(parseSortMode(value)).toEqual(mode)
      })
    }

    it('includes Secure attribute when secure=true', () => {
      const header = serializeSortCookie({ mode: 'new' }, true)
      expect(header).toContain('Secure')
    })

    it('omits Secure attribute when secure=false', () => {
      const header = serializeSortCookie({ mode: 'new' }, false)
      expect(header).not.toContain('Secure')
    })
  })

  describe('resolution precedence: URL > cookie > default', () => {
    // This mirrors the fold in home.tsx loader — tested here as pure logic.
    function resolveSort(urlParam: string | null, cookieValue?: string) {
      const urlSort = parseSortMode(urlParam)
      const cookieSort = cookieValue !== undefined ? readSortCookie(makeRequest(cookieValue)) : null
      return urlSort ?? cookieSort ?? defaultSortMode
    }

    it('URL param wins over cookie', () => {
      expect(resolveSort('new', 'top')).toEqual({ mode: 'new' })
    })

    it('cookie wins over default when no URL param', () => {
      expect(resolveSort(null, 'new')).toEqual({ mode: 'new' })
    })

    it('falls back to defaultSortMode when no URL param and no cookie', () => {
      expect(resolveSort(null, undefined)).toEqual(defaultSortMode)
    })

    it('unknown URL param falls through to cookie', () => {
      expect(resolveSort('garbage', 'new')).toEqual({ mode: 'new' })
    })

    it('unknown URL param and no cookie falls to default', () => {
      expect(resolveSort('garbage', undefined)).toEqual(defaultSortMode)
    })
  })
})
