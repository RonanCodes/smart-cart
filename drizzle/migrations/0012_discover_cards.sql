CREATE TABLE `discover_cards` (
	`household_id` text PRIMARY KEY NOT NULL,
	`cards_json` text NOT NULL,
	`generated_at` integer NOT NULL
);
