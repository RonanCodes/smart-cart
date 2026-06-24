CREATE TABLE IF NOT EXISTS `feature_flag` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`updated_at` integer NOT NULL
);
