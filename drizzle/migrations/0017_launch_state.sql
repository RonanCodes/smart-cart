CREATE TABLE `launch_state` (
	`scope` text PRIMARY KEY NOT NULL,
	`launched` integer DEFAULT false NOT NULL,
	`launched_at` integer,
	`updated_at` integer NOT NULL
);
