// [LAW:behavior-not-structure] Tests pin the contract of composePrompt:
//   - Happy path: the one Haiku call returns JSON {title, prompt}; both are parsed
//     and returned (trimmed).
//   - Placard: the meta-prompt asks for a title, and the parsed title is returned.
//   - Fallback path: when the call fails (throws / non-OK / missing key / malformed
//     JSON), BOTH halves fall back together — prompt to renderTemplate output, title
//     to the deterministic fallbackTitle placard.
//   - promptPrefix inclusion: meta-prompt includes the persona's voice when set.
//   - wish steering: the wish steers the meta-prompt but is never the returned
//     prompt, never reaches the recipe-only fallback, and is capped before embed.
//   - Truncation: prompt to maxLength, title to its own cap.
//   - Metric: slopspot.composer.result emitted with correct outcome/reason.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fallbackTitle,
  PLACARD_TITLE_MAX,
  recipeSubjectSchema,
  renderTemplate,
  sceneForWish,
  STYLE_FAMILY_PROMPT_SEEDS,
} from '~/lib/variety'
import { NEUTRAL_TRAITS } from '~/lib/traits'
import { composePrompt, WISH_DIRECTIVE, type ComposerInput } from './composer'

vi.mock('~/observability/metrics', () => ({ emit: vi.fn(), emitAccountHealth: vi.fn() }))
import { emit } from '~/observability/metrics'

function mockEnv(apiKey: string | undefined): Env {
  return { SLOPSPOT_ANTHROPIC_API_KEY: apiKey } as unknown as Env
}

function makeInput(overrides: Partial<ComposerInput> = {}): ComposerInput {
  const subject = recipeSubjectSchema.parse({
    subjectTemplate: 'T01',
    slots: { animal: 'cat', profession: 'surgeon' },
  })
  return {
    styleFamily: 'photoreal',
    subject,
    aspectRatio: '1:1',
    // [LAW:single-enforcer] traits is required — neutral is the firehose's real position,
    // projecting to an empty register steer (a no-op). Tests that exercise the lever override it.
    traits: NEUTRAL_TRAITS,
    ...overrides,
  }
}

// The Haiku response shape: one text block whose body is the JSON the composer parses.
function jsonResponse(title: string, prompt: string): Response {
  return {
    ok: true,
    json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ title, prompt }) }] }),
  } as Response
}

function expectedFallback(input: ComposerInput) {
  // Independently mirror the composer's depiction seam: a wish renders the embalmed/receded
  // SCENE (sceneForWish), otherwise the raw recipe template. Because the Haiku-down fallback
  // reads the same depiction value, the wish's no-live-creature invariant (move-7) holds on the
  // FAILURE path too — not only when Haiku succeeds (3aj.13.2). For a non-animal template
  // sceneForWish === renderTemplate, so the non-wish callers are byte-for-byte unchanged.
  const depiction =
    input.occasion?.kind === 'wish' ? sceneForWish(input.subject) : renderTemplate(input.subject)
  const styleSeed = STYLE_FAMILY_PROMPT_SEEDS[input.styleFamily]
  const raw = input.promptPrefix
    ? `${input.promptPrefix}, ${depiction}, ${styleSeed}`
    : `${depiction}, ${styleSeed}`
  // Mirror the composer: the fallback prompt respects maxLength too, not only the
  // Haiku-success path.
  const prompt =
    input.maxLength && raw.length > input.maxLength ? raw.slice(0, input.maxLength) : raw
  return { prompt, title: fallbackTitle(input.subject) }
}

describe('composePrompt', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.mocked(emit).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the parsed prompt AND placard title when the call succeeds', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      jsonResponse('The Cursed One', 'A weathered surgeon cat under harsh fluorescent lighting'),
    )

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result).toEqual({
      title: 'The Cursed One',
      prompt: 'A weathered surgeon cat under harsh fluorescent lighting',
    })
    expect(emit).toHaveBeenCalledWith('slopspot.composer.result', { outcome: 'haiku' }, 1)
  })

  it('asks Haiku for a placard title in the meta-prompt', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('A Name', 'a prompt')
    })

    await composePrompt(makeInput(), mockEnv('test-key'))
    expect(capturedBody).toContain('placard')
  })

  it('falls back (prompt + title together) when fetch throws', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('network error'))

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result).toEqual(expectedFallback(input))
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'api_error' },
      1,
    )
  })

  it('falls back when Anthropic returns a non-OK status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as Response)

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result).toEqual(expectedFallback(input))
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'api_error' },
      1,
    )
  })

  // [LAW:no-silent-fallbacks] A dead/expired key (Anthropic 401) is the operator-
  // actionable degradation that silently template-fell-back the whole firehose in the
  // breeding bug (slopspot-breeding-3xe.1). It must emit a DISTINCT, alert-worthy
  // reason — not be lumped with transient 5xx blips. 403 is classified the same way.
  it('emits the auth_error reason (not api_error) when Anthropic returns 401', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"type":"error","error":{"type":"authentication_error"}}',
    } as Response)

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('stale-key'))
    expect(result).toEqual(expectedFallback(input)) // composition still degrades gracefully
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'auth_error' },
      1,
    )
  })

  it('tolerates a markdown-fenced JSON response (Haiku wraps it despite instructions)', async () => {
    const fenced = '```json\n{"title":"Fenced Name","prompt":"a fenced prompt"}\n```'
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: fenced }] }),
    } as Response)

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result).toEqual({ title: 'Fenced Name', prompt: 'a fenced prompt' })
    expect(emit).toHaveBeenCalledWith('slopspot.composer.result', { outcome: 'haiku' }, 1)
  })

  it('extracts the object even when a string contains braces and prose trails it', async () => {
    // The prompt value contains { and }, and the model appends commentary after the
    // object. A first-brace-to-last-brace slice would grab the trailing brace; the
    // balanced scanner extracts the complete object.
    const body =
      '{"title":"The {Cursed} One","prompt":"a sign reading {OPEN} at 3am"}\n\nHope that works! }'
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: body }] }),
    } as Response)

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result).toEqual({ title: 'The {Cursed} One', prompt: 'a sign reading {OPEN} at 3am' })
  })

  it('falls back when the Haiku response has no JSON object at all', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'just a bare prompt, no JSON' }] }),
    } as Response)

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result).toEqual(expectedFallback(input))
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'api_error' },
      1,
    )
  })

  it('falls back when the JSON has a present-but-empty title', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('', 'a fine prompt'))

    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result).toEqual(expectedFallback(input))
  })

  it('falls back when SLOPSPOT_ANTHROPIC_API_KEY is absent (no fetch call)', async () => {
    const input = makeInput()
    const result = await composePrompt(input, mockEnv(undefined))
    expect(result).toEqual(expectedFallback(input))
    expect(fetch).not.toHaveBeenCalled()
    expect(emit).toHaveBeenCalledWith(
      'slopspot.composer.result',
      { outcome: 'fallback', reason: 'missing_key' },
      1,
    )
  })

  it('the fallback title is a deterministic placard, never empty, never the prompt', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))
    const input = makeInput()
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result.title.length).toBeGreaterThan(0)
    expect(result.title).not.toBe(result.prompt)
    expect(result.title).toBe(fallbackTitle(input.subject))
  })

  it('promptPrefix (the persona voice) is prepended in the fallback prompt', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))
    const input = makeInput({ promptPrefix: 'ethereal, dreamlike' })
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result.prompt.startsWith('ethereal, dreamlike,')).toBe(true)
  })

  it('promptPrefix (the persona voice) is included in the Haiku meta-prompt body', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('A Name', 'ethereal generated prompt')
    })

    await composePrompt(makeInput({ promptPrefix: 'gritty noir' }), mockEnv('test-key'))
    expect(capturedBody).toContain('gritty noir')
  })

  // [RECONCILE B] The wish is provenance the composer READS to steer Haiku — the
  // returned prompt is always the machine's authorship, never the raw wish.
  it('wish-seeded composition steers the meta-prompt but returns the machine prompt, not the wish', async () => {
    const wish = 'a cozy cottage by a quiet lake at dawn'
    const machinePrompt = 'A fractured neon cathedral devouring a lake, signage everywhere'
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Lakeside Heresy', machinePrompt)
    })

    const result = await composePrompt(makeInput({ occasion: { kind: 'wish', wish } }), mockEnv('test-key'))

    expect(capturedBody).toContain(wish)
    expect(result.prompt).toBe(machinePrompt)
    expect(result.prompt).not.toContain(wish)
  })

  // [LAW:behavior-not-structure] The OBJECTIFY-THE-INTRUSION contract (the-muse-doctrine.md,
  // slopspot-wishing-well-97o): a wish occasion ships the WISH_DIRECTIVE into the Haiku call,
  // so the "meat-brained literal render" loophole cannot silently reopen by deleting it. The
  // behavioral proof (a literal wish does NOT come back as a faithful composite) is the
  // doctrine's acceptance battery, which needs a live model. This guard asserts the directive's
  // PRESENCE via the shared constant — not its verbatim wording — so a harmless reword of the
  // directive moves the constant and this test together rather than breaking it.
  it('a wish occasion ships the objectify-the-intrusion directive into the Haiku call', async () => {
    const wish = "cindy crawford's body with a big mac for a head"
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Displaced Idol', 'A reliquary altar, a paper crown where a face should be')
    })

    await composePrompt(makeInput({ occasion: { kind: 'wish', wish } }), mockEnv('test-key'))

    expect(capturedBody).toBeDefined()
    // The directive (whatever its wording) is present in the instruction to Haiku.
    expect(capturedBody).toContain(WISH_DIRECTIVE)
  })

  // [LAW:behavior-not-structure] slopspot-render-fidelity-g5e: the round-11 CD verdict surfaced a
  // FOURTH failure pole — VANISH/BURY: an embalmed relic dissolved into its OWN dense scene even when
  // the prompt is clean (Vesper's teeming baroque eats its own subject). The CD's A ruling names VANISH
  // distinctly ALONGSIDE the three existing poles rather than folding it into IGNORE (where the
  // anti-vanish clause had been losing the priority fight to a baroque voice). This guard asserts the
  // failure TAXONOMY stays complete — the four named poles are the doctrine's contract, so a reword
  // that silently drops one fails here. It does not pin the surrounding wording.
  it('the wish directive names the complete four-pole failure taxonomy (incl. VANISH)', () => {
    expect(WISH_DIRECTIVE).toContain('DECORATE-THE-INTRUSION')
    expect(WISH_DIRECTIVE).toContain('IGNORE-THE-INTRUSION')
    expect(WISH_DIRECTIVE).toContain('VANISH-THE-INTRUSION')
    // The creature-specific SWAP pole is named by its verb, not a "-THE-INTRUSION" token.
    expect(WISH_DIRECTIVE).toContain('SWAPPED, not kept')
  })

  // [LAW:behavior-not-structure] move-5 (slopspot-well-foundation-3aj): the SUBJECT slot. On a wish
  // occasion the recipe subject is demoted from the thing DEPICTED to the SCENE the wished relic is
  // mounted in. The two-competing-subjects shape (recipe-subject-as-primary + wish-overlay) let
  // strong-voiced citizens embalm the recipe subject and discard the wish (round-9 gm-cat-a). The
  // contract is the SLOT, pinned minimally: the wish meta-prompt must NOT tell Haiku to "depict" the
  // recipe subject, yet must still carry it (the scene is the citizen's world, never discarded).
  // Survives any rewording of the scene framing — it asserts only that the recipe subject is no
  // longer the subject for wishes.
  it('a wish occasion makes the recipe subject the SCENE, not the depicted subject', async () => {
    const wish = 'a cozy cottage by a quiet lake at dawn'
    let wishBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      wishBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Lakeside Heresy', 'A machine prompt')
    })
    // [LAW:behavior-not-structure] move-7 (slopspot-well-foundation-3aj.13) supersedes "the RAW
    // recipe subject survives" for the ~12 {animal}-bearing templates — there the live creature is
    // embalmed-or-dropped, so the raw render no longer appears (asserted in the move-7 test below).
    // makeInput's default subject is T01 (an {animal} template), so this move-5 control pins its
    // invariant on a NON-animal subject, where sceneForWish === renderTemplate and the world survives
    // verbatim. The two contracts compose: non-animal scenes pass through, animal scenes petrify.
    const subject = recipeSubjectSchema.parse({
      subjectTemplate: 'T05',
      slots: { setting: 'a tide pool', timeOfDay: 'dusk' },
    })
    const input = makeInput({ subject, occasion: { kind: 'wish', wish } })
    const recipeSubject = renderTemplate(input.subject)

    await composePrompt(input, mockEnv('test-key'))

    expect(wishBody).toBeDefined()
    // The recipe subject survives as the SCENE — the citizen's world is never discarded.
    expect(wishBody).toContain(recipeSubject)
    // But Haiku is NOT instructed to depict it: the subject slot is reserved for the wished relic.
    expect(wishBody).not.toContain(`depicting ${recipeSubject}`)
  })

  // move-7 (slopspot-well-foundation-3aj.13): scene-not-menagerie. On a WISH occasion an {animal}-
  // bearing recipe-subject must NEVER reach the render as a LIVING co-subject — the raw live-actor
  // phrase ("a raven working as a clerk") is replaced by sceneForWish, which embalms the creature into
  // the setting as an inanimate motif or recedes it.
  // [LAW:behavior-not-structure] The assertions are WORDING-INVARIANT: they pin the WIRING property
  // (raw live-actor render absent; the sceneForWish value is what reaches the body), reading
  // sceneForWish's own output rather than any literal scene string — so they survive the CD's
  // pending ruling on the per-template embalm-vs-recede wording.
  it('a wish never lets an {animal} recipe-subject reach the render as a live co-creature', async () => {
    // One valid RecipeSubject per {animal}-bearing template (slots are validated for length only, not
    // vocab membership, so any non-empty value is legal). 'raven' is the canonical round-11 offender.
    const animalSubjects = [
      { subjectTemplate: 'T01', slots: { animal: 'raven', profession: 'clerk' } },
      { subjectTemplate: 'T02', slots: { animal: 'raven', emotion: 'grief' } },
      { subjectTemplate: 'T08', slots: { animal: 'raven', abstractConcept: 'bureaucracy' } },
      { subjectTemplate: 'T14', slots: { animal: 'raven', abstractConcept: 'bureaucracy' } },
      { subjectTemplate: 'T17', slots: { animal: 'raven', manMadeObject: 'ledger' } },
      { subjectTemplate: 'T18', slots: { profession: 'clerk', animal: 'raven' } },
      { subjectTemplate: 'T22', slots: { animal: 'raven', abstractConcept: 'bureaucracy' } },
      { subjectTemplate: 'T25', slots: { era: 'Victorian', animal: 'raven' } },
      { subjectTemplate: 'T29', slots: { animal: 'raven' } },
      { subjectTemplate: 'T30', slots: { profession: 'clerk', animal: 'raven' } },
      { subjectTemplate: 'T33', slots: { animal: 'raven' } },
      { subjectTemplate: 'T38', slots: { animal: 'raven' } },
    ]

    for (const raw of animalSubjects) {
      const subject = recipeSubjectSchema.parse(raw)
      let body: string | undefined
      vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
        body = typeof init?.body === 'string' ? init.body : undefined
        return jsonResponse('Embalmed', 'A machine prompt')
      })

      await composePrompt(
        makeInput({ subject, occasion: { kind: 'wish', wish: 'a cat' } }),
        mockEnv('test-key'),
      )

      expect(body, `${raw.subjectTemplate} body captured`).toBeDefined()
      // The raw LIVE-actor render ("a raven working as a clerk") never reaches Haiku.
      expect(body, `${raw.subjectTemplate}: raw live-actor phrase removed`).not.toContain(
        renderTemplate(subject),
      )
      // The transformed scene IS what reaches Haiku (the wish-assembly swap fired).
      expect(body, `${raw.subjectTemplate}: transformed scene present`).toContain(
        sceneForWish(subject),
      )
    }
  })

  // The control proving move-5 is wish-SCOPED: the firehose path (no occasion) is unchanged — the
  // recipe subject IS the depicted subject. If this regresses, the change leaked past the wish gate.
  it('the firehose path still depicts the recipe subject (move-5 is wish-scoped)', async () => {
    let firehoseBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      firehoseBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Ordinary Slop', 'A machine prompt')
    })
    const input = makeInput()

    await composePrompt(input, mockEnv('test-key'))

    expect(firehoseBody).toContain(`depicting ${renderTemplate(input.subject)}`)
  })

  // move-7 polish (slopspot-well-foundation-3aj.13.1): the embalm-vs-recede split for the two templates
  // this ticket touched. T18 ("secretly a {animal}") EMBALMS the animal as an effigy motif; T29
  // ("captured in the act of forgetting") RECEDES it (the faded-mural embalm was unbuildable on the
  // render stack — see the rationale at the T29 entry in variety.ts). The wording-invariant signature of
  // embalm-vs-recede is whether the animal VALUE survives in the scene — embalm keeps it as a motif,
  // recede drops it — so this pins the SET membership without coupling to scene wording.
  // [LAW:behavior-not-structure]
  it('move-7 polish: T18 embalms its animal as a soft effigy; T29 recedes (animal dropped)', () => {
    const t18 = recipeSubjectSchema.parse({ subjectTemplate: 'T18', slots: { profession: 'clerk', animal: 'raven' } })
    expect(sceneForWish(t18), 'T18 embalms — animal survives as an effigy motif').toContain('raven')

    const receders = [
      { subjectTemplate: 'T29', slots: { animal: 'raven' } },
      { subjectTemplate: 'T02', slots: { animal: 'raven', emotion: 'grief' } },
      { subjectTemplate: 'T08', slots: { animal: 'raven', abstractConcept: 'bureaucracy' } },
      { subjectTemplate: 'T22', slots: { animal: 'raven', abstractConcept: 'bureaucracy' } },
    ]
    for (const raw of receders) {
      const subject = recipeSubjectSchema.parse(raw)
      expect(sceneForWish(subject), `${raw.subjectTemplate} recedes — animal dropped`).not.toContain(
        'raven',
      )
    }
  })

  it('a wish never reaches the recipe-only fallback when Haiku is unavailable', async () => {
    const wish = 'a cozy cottage by a quiet lake at dawn'
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))

    const input = makeInput({ occasion: { kind: 'wish', wish }, promptPrefix: 'austere' })
    const result = await composePrompt(input, mockEnv('test-key'))

    // [LAW:dataflow-not-control-flow] The wish has no authoring path but Haiku;
    // the fallback is recipe-only, so the human's words cannot leak verbatim.
    expect(result.prompt).not.toContain(wish)
    expect(result).toEqual(expectedFallback(input))
  })

  // [LAW:behavior-not-structure] move-7's invariant (a creature recipe-subject can never reach the
  // render as a LIVING co-subject) was previously verified ONLY on the Haiku-success path (the test
  // above on the meta-prompt body). On a Haiku OUTAGE the recipe-only fallback authored the depiction
  // from renderTemplate — the RAW live-actor phrase — silently re-opening the menagerie precisely when
  // the system is already degraded (3aj.13.2). The fix routes the wish fallback depiction through
  // sceneForWish too. This pins the WIRING property on the composed FALLBACK output (not the body),
  // wording-invariant: the raw live-actor phrase is absent, the embalmed/receded scene is what reaches
  // the prompt — the same two legal outcomes as the success-path sibling above.
  it('a Haiku outage still never lets an {animal} recipe-subject reach the fallback as a live co-creature', async () => {
    const animalSubjects = [
      { subjectTemplate: 'T01', slots: { animal: 'raven', profession: 'clerk' } },
      { subjectTemplate: 'T02', slots: { animal: 'raven', emotion: 'grief' } },
      { subjectTemplate: 'T08', slots: { animal: 'raven', abstractConcept: 'bureaucracy' } },
      { subjectTemplate: 'T14', slots: { animal: 'raven', abstractConcept: 'bureaucracy' } },
      { subjectTemplate: 'T17', slots: { animal: 'raven', manMadeObject: 'ledger' } },
      { subjectTemplate: 'T18', slots: { profession: 'clerk', animal: 'raven' } },
      { subjectTemplate: 'T22', slots: { animal: 'raven', abstractConcept: 'bureaucracy' } },
      { subjectTemplate: 'T25', slots: { era: 'Victorian', animal: 'raven' } },
      { subjectTemplate: 'T29', slots: { animal: 'raven' } },
      { subjectTemplate: 'T30', slots: { profession: 'clerk', animal: 'raven' } },
      { subjectTemplate: 'T33', slots: { animal: 'raven' } },
      { subjectTemplate: 'T38', slots: { animal: 'raven' } },
    ]

    for (const raw of animalSubjects) {
      const subject = recipeSubjectSchema.parse(raw)
      vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))

      const result = await composePrompt(
        makeInput({ subject, occasion: { kind: 'wish', wish: 'a cat' } }),
        mockEnv('test-key'),
      )

      // The raw LIVE-actor render ("a raven working as a clerk") never reaches the fallback prompt.
      expect(result.prompt, `${raw.subjectTemplate}: raw live-actor phrase absent from fallback`).not.toContain(
        renderTemplate(subject),
      )
      // The embalmed/receded scene IS what the degraded fallback renders.
      expect(result.prompt, `${raw.subjectTemplate}: transformed scene present in fallback`).toContain(
        sceneForWish(subject),
      )
    }
  })

  it('caps an over-long wish before embedding it in the Haiku request', async () => {
    const head = 'A'.repeat(1000)
    const tail = 'B'.repeat(4000)
    const wish = head + tail
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Capped', 'ok')
    })

    await composePrompt(makeInput({ occasion: { kind: 'wish', wish } }), mockEnv('test-key'))
    expect(capturedBody).toContain(head)
    expect(capturedBody).not.toContain(tail)
  })

  // The self-portrait occasion (roll-call-47p.6) swaps the DEPICTION to the citizen
  // itself; the recipe subject no longer drives what Haiku is told to render.
  it('a self-portrait occasion depicts the citizen, not the recipe subject', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('A Stark Face', 'a figure in an empty hallway')
    })

    const input = makeInput({ occasion: { kind: 'self-portrait', displayName: 'GutterMonk' } })
    await composePrompt(input, mockEnv('test-key'))

    // The meta-prompt depicts GutterMonk's self-portrait, not the recipe's subject.
    expect(capturedBody).toContain('self-portrait of GutterMonk')
    expect(capturedBody).not.toContain(renderTemplate(input.subject))
  })

  // On the Haiku-failure fallback, the placard must track the depiction — a
  // self-portrait is named for the citizen, not the recipe's subject, so the image
  // and its title never describe different things.
  it('the self-portrait fallback title names the citizen, not the recipe subject', async () => {
    const input = makeInput({ occasion: { kind: 'self-portrait', displayName: 'GutterMonk' } })
    const result = await composePrompt(input, mockEnv(undefined)) // no key → fallback

    expect(result.title).toBe('GutterMonk')
    expect(result.title).not.toBe(fallbackTitle(input.subject))
  })

  // [LAW:single-enforcer] The breed occasion (L2) recombines two parent UTTERANCES into the child's
  // voice on the SAME composer — both parents steer Haiku, neither is the returned prompt verbatim.
  it('a breed occasion steers Haiku with BOTH parent utterances, isolated and not returned raw', async () => {
    const parentA = 'a reliquary of melted halos under a dead fluorescent sky'
    const parentB = 'thirteen identical saints, each missing the same finger'
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('The Inheritance', 'a single saint cradling a melted halo, one finger short')
    })

    const result = await composePrompt(
      makeInput({ occasion: { kind: 'breed', parents: [parentA, parentB] } }),
      mockEnv('test-key'),
    )

    // Both parents reach the model as steering...
    expect(capturedBody).toContain(parentA)
    expect(capturedBody).toContain(parentB)
    expect(capturedBody).toContain('CROSS of two lineages')
    // ...but the child is the machine's own authorship, never either parent echoed verbatim.
    expect(result.prompt).not.toContain(parentA)
    expect(result.prompt).not.toContain(parentB)
  })

  it('caps over-long parent utterances before embedding them in the breed request', async () => {
    const head = 'A'.repeat(1000)
    const tail = 'B'.repeat(4000)
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Capped', 'ok')
    })

    await composePrompt(
      makeInput({ occasion: { kind: 'breed', parents: [head + tail, 'short'] } }),
      mockEnv('test-key'),
    )
    expect(capturedBody).toContain(head)
    expect(capturedBody).not.toContain(tail)
  })

  // [LAW:single-enforcer] The genome's register steers composition via the one traitBias projection.
  // A leaning bloodline bends the words; the neutral firehose embeds no register line.
  it('a leaning earnestness register reaches Haiku as the drop-vs-add device instruction', async () => {
    let sincereBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      sincereBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('A Held Breath', 'a figure gazed at as genuinely holy')
    })
    await composePrompt(
      makeInput({ traits: { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.95 } }),
      mockEnv('test-key'),
    )
    expect(sincereBody).toContain('Register')
    // SHOW-not-tell: the sincere steer carries concrete devotional acts, never a "no irony" negation.
    expect(sincereBody).toContain('kneels before the thing')

    let ironicBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      ironicBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Sixth Finger, Heh', 'a saint winking at its own glitch')
    })
    await composePrompt(
      makeInput({ traits: { austerity: 0.5, curse: 0.5, density: 0.5, earnestness: 0.05 } }),
      mockEnv('test-key'),
    )
    expect(ironicBody).toContain('KEEP the distancing devices')
  })

  it('the neutral firehose register embeds NO register line (a no-op steer)', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('Plain', 'a plain thing')
    })
    await composePrompt(makeInput(), mockEnv('test-key')) // neutral traits by default
    expect(capturedBody).not.toContain('Register —')
  })

  it('trims leading/trailing whitespace from the parsed prompt and title', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('  Padded Name  ', '  padded response  '))

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result.prompt).toBe('padded response')
    expect(result.title).toBe('Padded Name')
  })

  it('truncates the prompt to maxLength if it exceeds it', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('A Name', 'x'.repeat(600)))

    const result = await composePrompt(makeInput({ maxLength: 500 }), mockEnv('test-key'))
    expect(result.prompt).toHaveLength(500)
  })

  it('truncates the FALLBACK prompt to maxLength too (not only the Haiku path)', async () => {
    // A long persona voice forces the recipe-only fallback prompt over a small cap;
    // the fallback must still respect maxLength or downstream params validation fails.
    vi.mocked(fetch).mockRejectedValueOnce(new Error('down'))
    const input = makeInput({ promptPrefix: 'x'.repeat(300), maxLength: 120 })
    const result = await composePrompt(input, mockEnv('test-key'))
    expect(result.prompt.length).toBeLessThanOrEqual(120)
    expect(result).toEqual(expectedFallback(input))
  })

  it('does not truncate the prompt when within maxLength', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('A Name', 'x'.repeat(400)))

    const result = await composePrompt(makeInput({ maxLength: 500 }), mockEnv('test-key'))
    expect(result.prompt).toHaveLength(400)
  })

  it('truncates an over-long title to its own cap', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse('N'.repeat(200), 'a prompt'))

    const result = await composePrompt(makeInput(), mockEnv('test-key'))
    expect(result.title.length).toBeLessThanOrEqual(PLACARD_TITLE_MAX)
  })

  it('maxLength is included as a constraint in the meta-prompt sent to Haiku', async () => {
    let capturedBody: string | undefined
    vi.mocked(fetch).mockImplementationOnce(async (_url, init) => {
      capturedBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse('A Name', 'ok')
    })

    await composePrompt(makeInput({ maxLength: 500 }), mockEnv('test-key'))
    expect(capturedBody).toContain('500')
  })
})
