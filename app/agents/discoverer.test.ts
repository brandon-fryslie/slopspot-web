// [LAW:behavior-not-structure] These tests pin runDiscoveryPass contracts —
// what it does given a persona + fake fetch results + fake z.ai judgments.
// All I/O is mocked: no real D1, no real fetch, no real z.ai calls.
// The contract under test: given a persona with seedUrls and a z.ai score
// above judgeThreshold, runDiscoveryPass submits exactly one found post.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Persona } from './persona'
import { AgentId, PostId } from '~/lib/domain'

// --- Mocks (hoisted above the import under test) ---

vi.mock('~/agents/persona', () => ({
  pickPersona: vi.fn(),
}))

vi.mock('~/agents/zai', () => ({
  chat: vi.fn(),
}))

vi.mock('~/db/posts', () => ({
  createPost: vi.fn(),
}))

// knownFoundUrls inside discoverer.ts calls db(env).select()...
// Mock the whole db client so dedup returns an empty set (no prior submissions).
vi.mock('~/db/client', () => ({
  db: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  }),
}))

vi.mock('~/db/schema', () => ({
  found: { url: 'found.url' },
}))

// drizzle-orm inArray is called dynamically; stub it to return a no-op object.
vi.mock('drizzle-orm', () => ({
  inArray: vi.fn().mockReturnValue({}),
}))

// Import the module under test AFTER all mocks are declared.
import { runDiscoveryPass } from './discoverer'
import { pickPersona } from '~/agents/persona'
import { chat } from '~/agents/zai'
import { createPost } from '~/db/posts'

const STUB_ENV = {} as Env

const STUB_PERSONA: Persona = {
  agentId: AgentId('agent:tasteful-curator'),
  displayName: 'The Tasteful Curator',
  role: 'discoverer',
  personaPrompt: 'You are a curator.',
  modelId: 'glm-4v-flash',
  config: {
    seedUrls: ['https://example-ai-gallery.com/feed'],
    judgeThreshold: 70,
    submissionsPerPass: 1,
  },
}

const STUB_PAGE_HTML = `
  <html>
    <head>
      <meta property="og:image" content="https://cdn.example.com/images/ai-art-01.jpg" />
      <meta property="og:title" content="Surreal AI Landscape" />
      <meta property="og:url" content="https://example-ai-gallery.com/posts/42" />
    </head>
    <body></body>
  </html>
`

function htmlResponse(body: string) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

describe('runDiscoveryPass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips when no personas are available', async () => {
    vi.mocked(pickPersona).mockResolvedValue(null)

    await runDiscoveryPass(STUB_ENV, 1234567890)

    expect(createPost).not.toHaveBeenCalled()
  })

  it('submits one found post when candidate scores above threshold', async () => {
    vi.mocked(pickPersona).mockResolvedValue(STUB_PERSONA)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(STUB_PAGE_HTML))
    vi.mocked(chat).mockResolvedValue('82\nThis surreal landscape has the kind of impossible geometry I live for.')
    vi.mocked(createPost).mockResolvedValue({
      id: PostId('post-abc'),
      createdAt: new Date(),
      origin: { actor: { kind: 'agent', agentId: AgentId('agent:tasteful-curator') } },
      content: {
        kind: 'found',
        url: 'https://example-ai-gallery.com/posts/42',
        title: 'Surreal AI Landscape',
        description: 'This surreal landscape has the kind of impossible geometry I live for.',
      },
    })

    await runDiscoveryPass(STUB_ENV, 1234567890)

    expect(createPost).toHaveBeenCalledOnce()
    const [input] = vi.mocked(createPost).mock.calls[0]
    expect(input.kind).toBe('found')
    if (input.kind !== 'found') return
    expect(input.url).toBe('https://example-ai-gallery.com/posts/42')
    expect(input.title).toBe('Surreal AI Landscape')
    expect(input.origin.actor.kind).toBe('agent')
    if (input.origin.actor.kind !== 'agent') return
    expect(input.origin.actor.agentId).toBe('agent:tasteful-curator')
  })

  it('does not submit when candidate scores below threshold', async () => {
    vi.mocked(pickPersona).mockResolvedValue(STUB_PERSONA)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(htmlResponse(STUB_PAGE_HTML))
    // Score 50 is below the threshold of 70.
    vi.mocked(chat).mockResolvedValue('50\nNot interesting enough.')

    await runDiscoveryPass(STUB_ENV, 1234567890)

    expect(createPost).not.toHaveBeenCalled()
  })

  it('skips a seedUrl that returns non-HTML content', async () => {
    const persona: Persona = {
      ...STUB_PERSONA,
      config: {
        ...STUB_PERSONA.config,
        seedUrls: ['https://example-ai-gallery.com/image.jpg'],
      },
    }
    vi.mocked(pickPersona).mockResolvedValue(persona)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('binary', {
        status: 200,
        headers: { 'content-type': 'image/jpeg' },
      }),
    )

    await runDiscoveryPass(STUB_ENV, 1234567890)

    expect(createPost).not.toHaveBeenCalled()
  })

  it('rejects config with empty seedUrls', async () => {
    const persona: Persona = {
      ...STUB_PERSONA,
      config: { seedUrls: [], judgeThreshold: 70, submissionsPerPass: 1 },
    }
    vi.mocked(pickPersona).mockResolvedValue(persona)

    await expect(runDiscoveryPass(STUB_ENV, 1234567890)).rejects.toThrow(
      /config_json failed validation/,
    )
  })

  it('respects submissionsPerPass=2 by submitting up to 2 candidates', async () => {
    const persona: Persona = {
      ...STUB_PERSONA,
      config: {
        seedUrls: [
          'https://gallery.example.com/page1',
          'https://gallery.example.com/page2',
        ],
        judgeThreshold: 70,
        submissionsPerPass: 2,
      },
    }
    vi.mocked(pickPersona).mockResolvedValue(persona)

    let fetchCount = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      fetchCount++
      // Each page has a different OG URL so they're treated as distinct candidates.
      const html = STUB_PAGE_HTML.replace('posts/42', `posts/${fetchCount}`)
      return Promise.resolve(htmlResponse(html))
    })
    vi.mocked(chat).mockResolvedValue('80\nGood stuff.')
    vi.mocked(createPost).mockResolvedValue({
      id: PostId('post-multi'),
      createdAt: new Date(),
      origin: { actor: { kind: 'agent', agentId: AgentId('agent:tasteful-curator') } },
      content: { kind: 'found', url: 'https://x.com', title: 'X' },
    })

    await runDiscoveryPass(STUB_ENV, 1234567890)

    expect(createPost).toHaveBeenCalledTimes(2)
  })
})
