CREATE TABLE "event" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"household_id" text,
	"type" text NOT NULL,
	"path" text,
	"data" jsonb,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE set null ON UPDATE no action;