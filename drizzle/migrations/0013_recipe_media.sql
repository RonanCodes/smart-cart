CREATE TABLE `recipe_media` (
	`recipe_id` text PRIMARY KEY NOT NULL,
	`video_url` text,
	`video_status` text,
	`video_prompt` text,
	`video_at` integer,
	`souso_knows` text,
	`souso_knows_at` integer,
	`created_at` integer NOT NULL
);
