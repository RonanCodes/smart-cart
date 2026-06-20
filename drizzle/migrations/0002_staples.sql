CREATE TABLE `staple` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`store` text NOT NULL,
	`price_cents` integer,
	`product_slug` text,
	`product_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staple_household_product_unique` ON `staple` (`household_id`,`product_key`);
