CREATE TABLE `admin_notification_pref` (
	`email` text PRIMARY KEY NOT NULL,
	`waitlist_notify` integer DEFAULT true NOT NULL,
	`updated_at` integer NOT NULL
);
