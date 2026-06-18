CREATE TABLE "recipe" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_url" text,
	"title" text NOT NULL,
	"servings" integer,
	"prep_minutes" integer,
	"calories" integer,
	"category" text,
	"dietary_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ingredients" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"instructions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw" jsonb,
	"created_at" timestamp NOT NULL
);
