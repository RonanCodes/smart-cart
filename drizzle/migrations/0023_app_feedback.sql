CREATE TABLE `app_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`email` text,
	`message` text NOT NULL,
	`source` text DEFAULT 'bubble' NOT NULL,
	`path` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `app_feedback_created_at_idx` ON `app_feedback` (`created_at`);
