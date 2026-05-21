CREATE TABLE `generations` (
	`post_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`provider_version` text NOT NULL,
	`params_json` text NOT NULL,
	`parent_post_id` text,
	`style_family` text,
	`style_subject_template` text,
	`status` text NOT NULL,
	`queued_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`output_json` text,
	`failed_at` integer,
	`failed_reason` text,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "generations_status_shape" CHECK((
        ("generations"."status" = 'pending'
          AND "generations"."queued_at" IS NOT NULL
          AND "generations"."started_at" IS NULL
          AND "generations"."completed_at" IS NULL
          AND "generations"."output_json" IS NULL
          AND "generations"."failed_at" IS NULL
          AND "generations"."failed_reason" IS NULL)
        OR ("generations"."status" = 'running'
          AND "generations"."queued_at" IS NULL
          AND "generations"."started_at" IS NOT NULL
          AND "generations"."completed_at" IS NULL
          AND "generations"."output_json" IS NULL
          AND "generations"."failed_at" IS NULL
          AND "generations"."failed_reason" IS NULL)
        OR ("generations"."status" = 'succeeded'
          AND "generations"."queued_at" IS NULL
          AND "generations"."started_at" IS NULL
          AND "generations"."completed_at" IS NOT NULL
          AND "generations"."output_json" IS NOT NULL
          AND "generations"."failed_at" IS NULL
          AND "generations"."failed_reason" IS NULL)
        OR ("generations"."status" = 'failed'
          AND "generations"."queued_at" IS NULL
          AND "generations"."started_at" IS NULL
          AND "generations"."completed_at" IS NULL
          AND "generations"."output_json" IS NULL
          AND "generations"."failed_at" IS NOT NULL
          AND "generations"."failed_reason" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE INDEX `generations_status_idx` ON `generations` (`status`);--> statement-breakpoint
CREATE INDEX `generations_parent_idx` ON `generations` (`parent_post_id`);--> statement-breakpoint
CREATE TABLE `posts` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`content_kind` text NOT NULL,
	`origin_json` text NOT NULL,
	CONSTRAINT "posts_content_kind_shape" CHECK("posts"."content_kind" IN ('generation', 'upload'))
);
--> statement-breakpoint
CREATE INDEX `posts_created_at_idx` ON `posts` (`created_at`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`post_id` text PRIMARY KEY NOT NULL,
	`asset_json` text NOT NULL,
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`display_name` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `votes` (
	`post_id` text NOT NULL,
	`voter_id` text NOT NULL,
	`value` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`post_id`, `voter_id`),
	FOREIGN KEY (`post_id`) REFERENCES `posts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "votes_value_shape" CHECK("votes"."value" IN (-1, 1))
);
