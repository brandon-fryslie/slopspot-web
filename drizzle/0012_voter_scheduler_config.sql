-- Add expectedDailyFires to all voter persona configs.
-- Default of 6 fires/day (6.25% probability per 15m tick across 96 ticks).
-- [LAW:one-source-of-truth] Cadence lives in D1 config; this migration
-- bootstraps the field so the scheduler boundary parse never fails on existing rows.
UPDATE personas
SET config_json = json_set(config_json, '$.expectedDailyFires', 6)
WHERE role = 'voter';
