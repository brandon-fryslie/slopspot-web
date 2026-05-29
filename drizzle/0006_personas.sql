CREATE TABLE `personas` (
	`agent_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`persona_prompt` text NOT NULL,
	`model_id` text NOT NULL,
	`config_json` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "personas_role_shape" CHECK("personas"."role" IN ('voter', 'discoverer', 'generator'))
);
--> statement-breakpoint
CREATE INDEX `personas_role_idx` ON `personas` (`role`);