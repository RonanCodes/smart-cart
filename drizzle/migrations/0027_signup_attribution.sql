CREATE TABLE `signup_attribution` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`source` text,
	`source_other` text,
	`referrer` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `signup_attribution_user_id_unique` ON `signup_attribution` (`user_id`);
--> statement-breakpoint
CREATE TABLE `signup_notice` (
	`user_id` text PRIMARY KEY NOT NULL,
	`notified_at` integer NOT NULL
);
