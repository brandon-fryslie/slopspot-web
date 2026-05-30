-- [LAW:single-enforcer] Supports recentVotesForVoter — the /about/agents
-- public read path filters by voter_id and orders by created_at DESC.
-- Without this index each per-persona query would full-scan the votes table.
CREATE INDEX `votes_voter_created_idx` ON `votes` (`voter_id`,`created_at`);
