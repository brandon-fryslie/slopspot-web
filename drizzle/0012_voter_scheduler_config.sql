-- Seed expectedDailyFires on voter persona configs (default: 6 fires/day).
-- [LAW:one-source-of-truth] Cadence lives in D1 config; this migration
-- bootstraps the field so the scheduler boundary parse never fails on existing rows.
-- json_insert is a no-op when the path already exists, making this idempotent
-- on re-run (e.g. after a backup restore — it will not clobber operator edits).
UPDATE personas
SET config_json = json_insert(config_json, '$.expectedDailyFires', 6)
WHERE role = 'voter';
