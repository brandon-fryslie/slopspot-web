// [LAW:behavior-not-structure] Locks L3's binder wiring: authorBredSlop crosses two parents into an
// AUTHORED bred slop (author = the citizen owning the crossed medium; the breeder, if any, a mere
// modifier; the breed occasion carrying both parents' voices), and runGeneratorPass FOLDS the
// reproduction plan — bred → cross the selected parents, founder → a fresh persona-authored
// bloodline. The heavy seams (composer, createPost, the reads, the selection fold) are mocked so
// this asserts the WIRING deterministically with no D1, no network, no Haiku, no provider render.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const createPostMock = vi.fn()
const composePromptMock = vi.fn()
const getRecentRecipesMock = vi.fn()
const recordRemarkMock = vi.fn()
const pickNicheMock = vi.fn()
const getNicheGenePoolMock = vi.fn()
const selectReproductionMock = vi.fn()
const getPostByIdMock = vi.fn()
const pickPersonaMock = vi.fn()

vi.mock('~/db/posts', () => ({
  createPost: (...a: unknown[]) => createPostMock(...a),
  // authorBredSlop re-exports nothing from posts but api.breed maps InvalidParamsError; keep it real-ish.
  InvalidParamsError: class extends Error {},
}))
vi.mock('~/firehose/composer', () => ({ composePrompt: (...a: unknown[]) => composePromptMock(...a) }))
vi.mock('~/db/recent', () => ({ getRecentRecipes: (...a: unknown[]) => getRecentRecipesMock(...a) }))
vi.mock('~/db/remark', () => ({ recordRemark: (...a: unknown[]) => recordRemarkMock(...a) }))
vi.mock('~/firehose/niche', () => ({ pickNiche: (...a: unknown[]) => pickNicheMock(...a) }))
vi.mock('~/db/genepool', () => ({ getNicheGenePool: (...a: unknown[]) => getNicheGenePoolMock(...a) }))
vi.mock('~/firehose/select', () => ({ selectReproduction: (...a: unknown[]) => selectReproductionMock(...a) }))
vi.mock('~/db/feed', () => ({ getPostById: (...a: unknown[]) => getPostByIdMock(...a) }))
vi.mock('~/agents/persona', async (orig) => {
  const actual = await orig<typeof import('~/agents/persona')>()
  return { ...actual, pickPersona: (...a: unknown[]) => pickPersonaMock(...a) }
})

// Real providers so getProvider('fal-flux-mock') + realProviders(env) resolve (pure, no network).
import '~/providers'
import { authorBredSlop, runGeneratorPass, type BreedableParent } from '~/agents/generator'
import {
  AgentId,
  GenomeId,
  PostId,
  ProviderId,
  type Genome,
  type HumanModifier,
  type Post,
  type RecipeSubject,
} from '~/lib/domain'
import { NEUTRAL_TRAITS } from '~/lib/traits'

// No SLOPSPOT_ANTHROPIC_API_KEY → composer would fall back (but it's mocked here); no SLOPSPOT_ENV
// → not prod, so the fal-flux-mock medium is allowed past authorBredSlop's prod-mock guard.
const env = {} as Env

const FORM: RecipeSubject = { subjectTemplate: 'T00', slots: { freeText: 'a relic' } }
const MOCK_MEDIUM = ProviderId('fal-flux-mock')

const genome = (id: string, utterance: string): Genome => ({
  id: GenomeId(id),
  genes: { species: 'photoreal', form: FORM, frame: '1:1', medium: MOCK_MEDIUM },
  utterance,
  traits: NEUTRAL_TRAITS,
  lineage: { kind: 'founder' },
})

const VIVIAN = { kind: 'agent', agentId: AgentId('agent:vivian') } as const
const GREMLIN = { kind: 'agent', agentId: AgentId('agent:gremlin') } as const

const parent = (id: string, voice: string, author: typeof VIVIAN): BreedableParent => ({
  id: PostId(id),
  genome: genome(id, voice),
  author,
})

// A minimal generation Post for getPostById to return — only the fields loadBreedable reads.
const genPost = (id: string, voice: string, author: typeof VIVIAN): Post =>
  ({
    id: PostId(id),
    createdAt: new Date('2026-01-01'),
    origin: { kind: 'authored', author },
    content: { kind: 'generation', title: 'P', genome: genome(id, voice), render: {}, status: { kind: 'pending', queuedAt: new Date() } },
  }) as unknown as Post

beforeEach(() => {
  for (const m of [
    createPostMock, composePromptMock, getRecentRecipesMock, recordRemarkMock,
    pickNicheMock, getNicheGenePoolMock, selectReproductionMock, getPostByIdMock, pickPersonaMock,
  ]) m.mockReset()
  composePromptMock.mockResolvedValue({ prompt: 'the bred utterance', title: 'A Bred Placard' })
  createPostMock.mockResolvedValue({ id: PostId('child') })
  getRecentRecipesMock.mockResolvedValue([])
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

describe('authorBredSlop — the shared breed-authoring assembly', () => {
  it('authors a bred slop: bred lineage, author = the crossed-medium citizen, breed occasion carries both voices', async () => {
    // Both parents share the medium → the crossed medium is theirs, tie resolves to A (Vivian).
    await authorBredSlop(env, parent('A', 'parent A voice', VIVIAN), parent('B', 'parent B voice', GREMLIN), 42)

    expect(composePromptMock).toHaveBeenCalledTimes(1)
    const composerInput = composePromptMock.mock.calls[0][0]
    expect(composerInput.occasion).toEqual({ kind: 'breed', parents: ['parent A voice', 'parent B voice'] })

    expect(createPostMock).toHaveBeenCalledTimes(1)
    const [input] = createPostMock.mock.calls[0]
    expect(input.kind).toBe('generation')
    expect(input.lineage).toEqual({ kind: 'bred', parents: [GenomeId('A'), GenomeId('B')] })
    expect(input.utterance).toBe('the bred utterance')
    expect(input.title).toBe('A Bred Placard')
    expect(input.origin).toEqual({ kind: 'authored', author: VIVIAN }) // medium-owner, no human
  })

  it('attaches the human as a breeder MODIFIER when one is given (the Room), never as author', async () => {
    const human: HumanModifier = { role: 'breeder', by: { kind: 'anon', label: 'anon-xyz' } }
    await authorBredSlop(env, parent('A', 'va', VIVIAN), parent('B', 'vb', GREMLIN), 7, human)

    const [input] = createPostMock.mock.calls[0]
    expect(input.origin).toEqual({ kind: 'authored', author: VIVIAN, human })
  })
})

describe('runGeneratorPass — the reproduction fold', () => {
  it('bred plan → loads the two selected parents and crosses them (bred lineage written)', async () => {
    pickNicheMock.mockResolvedValue({ kind: 'citizen', voterId: 'agent:vivian' })
    getNicheGenePoolMock.mockResolvedValue([{ ref: PostId('A'), fitness: 1 }, { ref: PostId('B'), fitness: 1 }])
    selectReproductionMock.mockReturnValue({ kind: 'bred', parents: [PostId('A'), PostId('B')] })
    getPostByIdMock.mockImplementation((_e: Env, id: PostId) =>
      Promise.resolve(id === PostId('A') ? genPost('A', 'va', VIVIAN) : genPost('B', 'vb', GREMLIN)),
    )

    await runGeneratorPass(env, 1000)

    expect(getPostByIdMock).toHaveBeenCalledTimes(2)
    expect(pickPersonaMock).not.toHaveBeenCalled() // the bred path never picks a generator persona
    const [input] = createPostMock.mock.calls[0]
    expect(input.lineage).toEqual({ kind: 'bred', parents: [GenomeId('A'), GenomeId('B')] })
  })

  it('founder plan → a picked generator persona seeds a fresh founder bloodline', async () => {
    pickNicheMock.mockResolvedValue({ kind: 'populist', citizenVoterIds: [] })
    getNicheGenePoolMock.mockResolvedValue([])
    selectReproductionMock.mockReturnValue({ kind: 'founder' })
    pickPersonaMock.mockResolvedValue({
      agentId: AgentId('agent:maker'),
      handle: 'maker',
      displayName: 'The Maker',
      role: 'generator',
      personaPrompt: 'a maker',
      modelId: 'claude-haiku-4-5',
      config: { medium: 'fal-flux-mock' },
    })

    await runGeneratorPass(env, 2000)

    expect(getPostByIdMock).not.toHaveBeenCalled() // founder loads no parents
    const [input] = createPostMock.mock.calls[0]
    expect(input.lineage).toEqual({ kind: 'founder' })
  })

  it('founder plan with an empty generator pool fails loud (a slop must be authored by a citizen)', async () => {
    pickNicheMock.mockResolvedValue({ kind: 'populist', citizenVoterIds: [] })
    getNicheGenePoolMock.mockResolvedValue([])
    selectReproductionMock.mockReturnValue({ kind: 'founder' })
    pickPersonaMock.mockResolvedValue(null)

    await expect(runGeneratorPass(env, 3000)).rejects.toThrow(/no generator personas/)
  })
})
