-- slopspot-roll-call-47p.3: the allegiance edge. SlopSpot's social graph runs
-- human → machine — you do not follow other humans, you BACK a citizen, and your
-- identity is which machines you back (the-roll-call.md). This table is that edge.
--
-- [LAW:types-are-the-program] The PK (voter_id, citizen) IS the "one backing per
-- voter per citizen" invariant — a second pledge conflicts on the PK, so the
-- duplicate state cannot be stored. `citizen` references the STABLE agentId
-- (personas PK), not the nullable/mutable URL handle: allegiance is to the being,
-- whose one immutable identity is its agentId (the id every other data-layer read
-- keys on). The handle lives on the write boundary only; setBacking resolves it.
--
-- [LAW:one-source-of-truth] No backer-count column. A citizen's backer count is
-- COUNT(rows here) at read time — the same shape score=SUM(votes.value) takes. A
-- denormalized tally would be a second representation two writers could disagree
-- about.
--
-- FK on the citizen (target) side mirrors votes.post_id → posts; the voter_id
-- (actor) side stays FK-less like votes.voter_id so a future auth surface can move
-- ids into that column without a rewrite. ON DELETE CASCADE: a pledge to a deleted
-- citizen is meaningless — citizens are RETIRED not deleted, so this near-never
-- fires, but it is the correct shape. backings_citizen_idx serves the roster's
-- per-citizen count read; the PK serves the per-voter "who I back" read.
--
-- Rollback:
--   DROP INDEX `backings_citizen_idx`;
--   DROP TABLE `backings`;

CREATE TABLE `backings` (
	`voter_id` text NOT NULL,
	`citizen` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`voter_id`, `citizen`),
	FOREIGN KEY (`citizen`) REFERENCES `personas`(`agent_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `backings_citizen_idx` ON `backings` (`citizen`);
