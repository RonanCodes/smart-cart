CREATE TABLE `payment_mode` (
	`scope` text PRIMARY KEY NOT NULL,
	`mode` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tip_payment` ADD `mode` text DEFAULT 'test' NOT NULL;
