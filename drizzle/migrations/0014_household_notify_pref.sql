CREATE TABLE `household_notify_pref` (
	`household_id` text PRIMARY KEY NOT NULL,
	`plan_reminder_enabled` integer DEFAULT false NOT NULL,
	`plan_reminder_dow` integer DEFAULT 0 NOT NULL,
	`plan_reminder_time` text DEFAULT '17:00' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `nudge_log` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`kind` text NOT NULL,
	`sent_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nudge_log_household_kind_key` ON `nudge_log` (`household_id`,`kind`,`sent_key`);
