ALTER TABLE `store_product` ADD `embedding` text;--> statement-breakpoint
CREATE TABLE `recipe_embedding` (
	`recipe_id` text PRIMARY KEY NOT NULL,
	`embedding` text NOT NULL,
	`model` text NOT NULL,
	`dims` integer NOT NULL,
	`created_at` integer NOT NULL
);
