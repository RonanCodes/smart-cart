CREATE TABLE `access_grant` (
	`email` text PRIMARY KEY NOT NULL,
	`role` text NOT NULL,
	`created_at` integer NOT NULL
);
