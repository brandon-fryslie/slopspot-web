// [LAW:behavior-not-structure] Pins the 8q9.2 backfill contract: spoken
// verdict/reply utterances become citizen comments on their target post,
// preserving speaker, text, and ORIGINAL created time; everything else in the
// utterances table (withheld arms, post-less occasions, non-argument
// occasions) is untouched; and the migration is idempotent — a re-run adds
// zero rows. Assertions go through listComments, the same read path the
// product renders, so "the same bot lines through the comments read path" is
// verified literally.
//
// [LAW:one-source-of-truth] The SQL under test is not duplicated here: the
// test pulls the 0047 entry out of env.TEST_MIGRATIONS — the identical
// migration content `wrangler d1 migrations apply` runs in prod — and
// re-executes it against seeded data (the beforeAll pass ran it against an
// empty DB, a no-op by construction).

import { describe, expect, it } from 'vitest'
import { env } from 'cloudflare:test'
import { listComments } from '~/db/comments'
import { commentAuthorLabel } from '~/lib/author-label'
import { seedComment, seedPost, seedUtterance } from './helpers'

async function runUtteranceBackfill(prefix: '0047_' | '0048_' = '0047_'): Promise<void> {
  const migration = env.TEST_MIGRATIONS.find((m) => m.name.startsWith(prefix))
  // [LAW:no-silent-failure] A renamed/missing migration must fail the suite,
  // not silently test nothing.
  if (migration === undefined) throw new Error(`${prefix} utterance→comment migration not found in TEST_MIGRATIONS`)
  for (const query of migration.queries) {
    await env.DB.prepare(query).run()
  }
}

async function seedPersona(agentId: string, displayName: string) {
  await env.DB.prepare(
    "INSERT INTO personas (agent_id, handle, display_name, role, persona_prompt, model_id, config_json, created_at) VALUES (?, NULL, ?, 'voter', 'p', 'm', '{}', 1)",
  )
    .bind(agentId, displayName)
    .run()
}

describe('0047 verdict/reply utterance → comment backfill', () => {
  it('migrates a spoken verdict as a citizen comment with the original created time', async () => {
    const postId = await seedPost(env)
    const spokenAt = new Date('2026-03-15T12:00:00Z')
    await seedUtterance(env, {
      speaker: 'a:gremlin',
      targetPostId: postId,
      occasion: 'verdict',
      text: '  burial. the composition begs for mercy.  ',
      createdAt: spokenAt,
    })
    await seedPersona('a:gremlin', 'The Gremlin')

    await runUtteranceBackfill()

    const thread = await listComments(env, postId)
    expect(thread).toHaveLength(1)
    const comment = thread[0]
    // The body is exactly what the card renderer showed: the trimmed line.
    expect(comment.body).toBe('burial. the composition begs for mercy.')
    expect(comment.createdAt).toEqual(spokenAt)
    expect(comment.author.kind).toBe('agent')
    // The migrated author resolves through the same persona machinery as any
    // citizen comment — no separate migrated-row read path.
    expect(commentAuthorLabel(comment.author)).toBe('The Gremlin')
    // The id prefix is the documented provenance + rollback contract
    // (DELETE ... WHERE id LIKE 'utt-%' reverses exactly this migration).
    expect(comment.id.startsWith('utt-')).toBe(true)
  })

  it('migrates a verdict AND a reply by the same speaker on the same post as two comments', async () => {
    const postId = await seedPost(env)
    await seedUtterance(env, {
      speaker: 'a:vivian',
      targetPostId: postId,
      occasion: 'verdict',
      text: 'blessed. the light is honest.',
      createdAt: new Date('2026-03-01T00:00:00Z'),
    })
    await seedUtterance(env, {
      speaker: 'a:vivian',
      targetPostId: postId,
      occasion: 'reply',
      text: 'and I will not apologize for saying so.',
      createdAt: new Date('2026-03-02T00:00:00Z'),
    })

    await runUtteranceBackfill()

    const thread = await listComments(env, postId)
    expect(thread).toHaveLength(2)
    // Newest-first thread order, driven by the original utterance times.
    expect(thread[0].body).toBe('and I will not apologize for saying so.')
    expect(thread[1].body).toBe('blessed. the light is honest.')
  })

  it('is idempotent: a re-run adds zero rows', async () => {
    const postId = await seedPost(env)
    await seedUtterance(env, {
      speaker: 'a:critic',
      targetPostId: postId,
      occasion: 'verdict',
      text: 'a verdict line',
    })

    await runUtteranceBackfill()
    await runUtteranceBackfill()

    const thread = await listComments(env, postId)
    expect(thread).toHaveLength(1)
  })

  it('migrates only spoken verdict/reply rows with a target post', async () => {
    const postId = await seedPost(env)
    // Withheld: no text, nothing to say in a thread.
    await seedUtterance(env, {
      speaker: 'a:silent',
      targetPostId: postId,
      occasion: 'verdict',
      withheldReason: 'beneath-comment',
    })
    // Non-argument occasion on the post.
    await seedUtterance(env, {
      speaker: 'a:narrator',
      targetPostId: postId,
      occasion: 'caption',
      text: 'a caption, not an argument',
    })
    // Post-less occasion: no thread to land in.
    await seedUtterance(env, {
      speaker: 'a:mourner',
      targetPostId: null,
      occasion: 'eulogy',
      text: 'a eulogy for no post',
    })

    await runUtteranceBackfill()

    const thread = await listComments(env, postId)
    expect(thread).toHaveLength(0)
    const all = await env.DB.prepare('SELECT count(*) AS n FROM comments').first<{ n: number }>()
    expect(all?.n).toBe(0)
  })

  it('interleaves migrated citizen lines with existing visitor comments in one thread', async () => {
    const postId = await seedPost(env)
    await seedComment(env, {
      postId,
      body: 'a visitor was here first',
      createdAt: new Date('2026-02-01T00:00:00Z'),
    })
    await seedUtterance(env, {
      speaker: 'a:gremlin',
      targetPostId: postId,
      occasion: 'verdict',
      text: 'the visitor is wrong',
      createdAt: new Date('2026-02-02T00:00:00Z'),
    })

    await runUtteranceBackfill()

    const thread = await listComments(env, postId)
    expect(thread).toHaveLength(2)
    expect(thread[0].body).toBe('the visitor is wrong')
    expect(thread[0].author.kind).toBe('agent')
    expect(thread[1].body).toBe('a visitor was here first')
    expect(thread[1].author.kind).toBe('visitor')
  })
})

// [LAW:behavior-not-structure] The 8q9.3 catch-up contract: 0048 re-runs 0047's
// exact copy so utterances recorded AFTER 0047's deploy (the snapshot gap, while
// the old no-write-through Worker still served) land as comments, while every
// row 0047 already migrated is a no-op — the deterministic 'utt-' id is the
// entire dedup mechanism. Zero duplication is asserted, not assumed.
describe('0048 catch-up: the gap between 0047 and the runtime write-through', () => {
  it('migrates gap rows recorded after 0047 ran, without duplicating 0047 rows', async () => {
    const postId = await seedPost(env)
    await seedUtterance(env, {
      speaker: 'a:gremlin',
      targetPostId: postId,
      occasion: 'verdict',
      text: 'the pre-0047 line',
      createdAt: new Date('2026-06-01T00:00:00Z'),
    })
    await runUtteranceBackfill('0047_')

    // Speech recorded in the gap: after 0047's snapshot, before the write-through Worker.
    await seedUtterance(env, {
      speaker: 'a:vesper',
      targetPostId: postId,
      occasion: 'reply',
      text: 'the gap line',
      createdAt: new Date('2026-07-01T00:00:00Z'),
    })
    await runUtteranceBackfill('0048_')

    const thread = await listComments(env, postId)
    expect(thread).toHaveLength(2)
    expect(thread[0].body).toBe('the gap line')
    expect(thread[1].body).toBe('the pre-0047 line')
  })

  it('is idempotent: a re-run of 0048 adds zero rows', async () => {
    const postId = await seedPost(env)
    await seedUtterance(env, {
      speaker: 'a:critic',
      targetPostId: postId,
      occasion: 'verdict',
      text: 'a verdict line',
    })

    await runUtteranceBackfill('0048_')
    await runUtteranceBackfill('0048_')

    expect(await listComments(env, postId)).toHaveLength(1)
  })

  it('runs the same statement as 0047 — one logical backfill in two installments', async () => {
    const m47 = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0047_'))
    const m48 = env.TEST_MIGRATIONS.find((m) => m.name.startsWith('0048_'))
    if (m47 === undefined || m48 === undefined) throw new Error('backfill migrations missing from TEST_MIGRATIONS')
    // [LAW:one-source-of-truth] The catch-up's correctness rests on running the
    // IDENTICAL copy: a drifted WHERE or key expression would silently migrate a
    // different population. Header comments differ; the executable SQL must not.
    const executable = (queries: string[]) =>
      queries.map((q) =>
        q
          .split('\n')
          .filter((l) => !l.trim().startsWith('--'))
          .join('\n')
          .replace(/\s+/g, ' ')
          .trim(),
      )
    expect(executable([...m48.queries])).toEqual(executable([...m47.queries]))
  })
})
