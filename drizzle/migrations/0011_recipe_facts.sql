CREATE TABLE `recipe_facts` (
	`recipe_id` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL,
	`sources_json` text NOT NULL,
	`fetched_at` integer NOT NULL
);
