CREATE TABLE `shopping_list_item` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`amount` text,
	`unit` text,
	`checked` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `shopping_list_item_household_idx` ON `shopping_list_item` (`household_id`);
