CREATE TABLE `match_cache` (
	`id` text PRIMARY KEY NOT NULL,
	`store` text NOT NULL,
	`normalised_name` text NOT NULL,
	`slug` text,
	`confidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `match_cache_store_idx` ON `match_cache` (`store`);
