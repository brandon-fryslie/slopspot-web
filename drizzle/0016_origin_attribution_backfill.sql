-- slopspot-well-foundation-3aj.2: one slop type — origin is honest, persona-primary
-- attribution. The domain now models a generation's origin as `authored` with a
-- persona author (always); a human is only ever an optional modifier
-- (wisher | breeder | patron), never the author. See app/lib/domain.ts (Origin).
--
-- Legacy data violates that invariant: early human FORKS were stored as
-- generations authored directly by an anon human ({ actor: { kind: 'anon', ... } }),
-- which is exactly the "human author, no persona" state the new type forbids. The
-- feed reader fails loud on such a row by design, so this backfill must run with the
-- code that introduces the invariant.
--
-- The honest fix is the breeding-lineage rule applied retroactively: a bred slop is
-- AUTHORED by its bloodline's persona, and the human who bred it is the `breeder`
-- modifier. The recursive walk follows generations.parent_post_id past intermediate
-- anon forks to the first agent-authored ancestor (the original firehose post), takes
-- its agentId as the author, and records the forker as the breeder. Every fork chain
-- roots at an agent (firehose / agent-API generations are never anon), so resolution
-- is total. Cleanly-mappable rows (agent-authored generations, found posts) are left
-- as-is — the read boundary maps the legacy { actor } shape per content kind without
-- a rewrite; only the genuinely-illegal anon generations are touched here.
--
-- Idempotent: after the rewrite no generation has an anon actor, so a re-run matches
-- zero rows. No-op on a fresh/empty database.

WITH RECURSIVE chain(start_id, node_id, node_agent) AS (
  SELECT p.id, p.id, json_extract(p.origin_json, '$.actor.agentId')
    FROM posts p
   WHERE p.content_kind = 'generation'
     AND json_extract(p.origin_json, '$.actor.kind') = 'anon'
  UNION ALL
  SELECT c.start_id, par.id, json_extract(par.origin_json, '$.actor.agentId')
    FROM chain c
    JOIN generations g ON g.post_id = c.node_id
    JOIN posts par ON par.id = g.parent_post_id
   WHERE c.node_agent IS NULL
),
resolved AS (
  SELECT start_id, node_agent AS agent FROM chain WHERE node_agent IS NOT NULL
)
UPDATE posts
   SET origin_json = json_object(
       'kind', 'authored',
       'author', json_object('kind', 'agent', 'agentId', (SELECT agent FROM resolved WHERE start_id = posts.id)),
       'human', json_object(
         'role', 'breeder',
         'by', json_object('kind', 'anon', 'label', json_extract(posts.origin_json, '$.actor.label'))
       )
   )
 WHERE posts.content_kind = 'generation'
   AND json_extract(posts.origin_json, '$.actor.kind') = 'anon';
