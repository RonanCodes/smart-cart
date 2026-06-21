CREATE TABLE `household_memory` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`cuisine` text,
	`term` text,
	`polarity` text DEFAULT 'neutral' NOT NULL,
	`scope` text DEFAULT 'persistent' NOT NULL,
	`salience` integer DEFAULT 1 NOT NULL,
	`source` text NOT NULL,
	`expires_at` integer,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `household`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `household_memory_household_idx` ON `household_memory` (`household_id`);
