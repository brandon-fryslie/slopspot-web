-- slopspot-post-comments-8q9.2: migrate existing verdict/reply utterances into comments.
--
-- The bot argument under a post becomes real comment rows: every spoken verdict and
-- reply utterance with a target post is copied into the comments table as a
-- citizen-authored comment, preserving speaker, text, created time, and post. The
-- withheld arm carries no text and post-less occasions have no thread — neither is a
-- comment, so the WHERE excludes them by shape, not by data luck.
--
-- [LAW:one-source-of-truth] Idempotency + provenance in one key: the comment id is
-- 'utt-' || utterance id. recordUtterance UPSERTS in place (row id stable per
-- speaker/target/occasion, even across re-votes), so the derived id is stable and a
-- re-run lands on ON CONFLICT DO NOTHING — no duplicate rows, ever. The prefix cannot
-- collide with crypto.randomUUID() ids minted by createComment, and it IS the
-- comment→utterance provenance mark: a migrated row is recognizable by its id shape.
--
-- [LAW:single-enforcer] exception: this writes comments rows outside createComment.
-- createComment enforces the RUNTIME boundary (id minting, created_at = now, post
-- existence); a backfill needs the ORIGINAL utterance created_at and a DETERMINISTIC
-- id — widening the runtime API with a back-dating mode for a one-shot job would
-- outlive its only caller [LAW:no-mode-explosion]. The migration layer is this repo's
-- established second storage actor (personas 0007-0012, the 0046 visitor backfill).
-- Post existence is enforced here by construction: target_post_id is an FK to posts.
--
-- body is trim(text) — byte-identical to what the card renderer showed for these lines.
--
-- ROLLBACK: DELETE FROM comments WHERE id LIKE 'utt-%'; — the id prefix isolates
-- migrated rows exactly, zero blast radius on visitor or runtime citizen comments.
INSERT INTO comments (id, post_id, author_id, author_kind, body, created_at)
SELECT 'utt-' || u.id, u.target_post_id, u.speaker, 'agent', trim(u.text), u.created_at
FROM utterances u
WHERE u.occasion IN ('verdict', 'reply')
  AND u.kind = 'spoke'
  AND u.target_post_id IS NOT NULL
  AND trim(u.text) <> ''
ON CONFLICT(id) DO NOTHING;
