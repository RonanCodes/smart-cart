CREATE TABLE `store_product` (
	`id` text PRIMARY KEY NOT NULL,
	`store` text NOT NULL,
	`slug` text,
	`name` text NOT NULL,
	`price_cents` integer,
	`unit` text,
	`raw` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `store_product_store_idx` ON `store_product` (`store`);
