-- slopspot-content-sources-svq.2: per-voter daily quota for the /api/found
-- and /submit routes. (voter_id, date) composite primary key — one row per
-- voter per day, counter incremented atomically by app/lib/found-quota.ts.
-- Sibling shape to challenge_quota (0003) but keyed per-voter — the two
-- tables are kept separate because they have different keys, different
-- operators, and serve different threats (global generation ceiling vs.
-- per-voter anti-abuse on outbound links).

CREATE TABLE `found_submission_quota` (
	`voter_id` text NOT NULL,
	`date` text NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`voter_id`, `date`)
);
