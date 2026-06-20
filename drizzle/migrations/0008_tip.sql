CREATE TABLE `tip_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`period` text NOT NULL,
	`free_count_used` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tip_usage_household_period_unique` ON `tip_usage` (`household_id`,`period`);
--> statement-breakpoint
CREATE TABLE `tip_payment` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`basket_id` text,
	`percent` integer NOT NULL,
	`amount` text NOT NULL,
	`mollie_payment_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL
);
