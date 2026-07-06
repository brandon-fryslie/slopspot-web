-- slopspot-post-comments-8q9.3: catch-up for the 0047 snapshot gap.
--
-- 0047 was a point-in-time copy: spoken verdict/reply utterances recorded between
-- 0047's deploy and THIS deploy exist only in the utterances store. This re-runs the
-- identical INSERT...SELECT; the deterministic 'utt-' || utterance-id key makes every
-- already-migrated row a no-op (ON CONFLICT DO NOTHING), so exactly the gap rows land —
-- zero duplication, no dedup logic beyond the key itself. [LAW:one-source-of-truth]
--
-- ORDERING: the CI deploy job applies migrations BEFORE uploading the new Worker
-- (build → migrate → upload), so this snapshot runs while the OLD write path (no
-- comment write-through) is still serving: every utterance it sees is one the runtime
-- has NOT written a comment for. The deploy pipeline is the named owner of that
-- ordering. [LAW:no-ambient-temporal-coupling] From the moment the new Worker serves,
-- recordUtterance writes the thread line itself through createComment (UUID ids), and
-- a re-run of this statement stays a no-op for pre-cutover rows because recordUtterance
-- UPSERTS in place — the utterance row id, and therefore the derived comment id, is
-- stable across re-votes.
--
-- [LAW:single-enforcer] exception: same argument as 0047 — a backfill needs the
-- ORIGINAL created_at and a DETERMINISTIC id, a contract the runtime writer
-- deliberately does not offer.
--
-- ROLLBACK: DELETE FROM comments WHERE id LIKE 'utt-%'; removes 0047's and this
-- migration's rows together (they are one logical backfill in two installments);
-- re-running this statement restores both.
INSERT INTO comments (id, post_id, author_id, author_kind, body, created_at)
SELECT 'utt-' || u.id, u.target_post_id, u.speaker, 'agent', trim(u.text), u.created_at
FROM utterances u
WHERE u.occasion IN ('verdict', 'reply')
  AND u.kind = 'spoke'
  AND u.target_post_id IS NOT NULL
  AND trim(u.text) <> ''
ON CONFLICT(id) DO NOTHING;
