-- [LAW:one-source-of-truth] reasoning lives on the vote row — no sidecar store.
-- Nullable: cookie-anon votes (no AI reasoning) leave it NULL; agent votes
-- populated by the homelab voter service after z.ai vision judgment.
ALTER TABLE `votes` ADD `reasoning` text;
