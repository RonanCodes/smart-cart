CREATE TABLE "meal_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"meal_plan_id" text,
	"recipe_id" text,
	"rating" text NOT NULL,
	"note" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recipe_swipe" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"recipe_id" text NOT NULL,
	"direction" text NOT NULL,
	"round" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "protein" integer;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "cuisine" text;--> statement-breakpoint
ALTER TABLE "recipe" ADD COLUMN "meal_type" text DEFAULT 'dinner' NOT NULL;--> statement-breakpoint
ALTER TABLE "meal_feedback" ADD CONSTRAINT "meal_feedback_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_feedback" ADD CONSTRAINT "meal_feedback_meal_plan_id_meal_plan_id_fk" FOREIGN KEY ("meal_plan_id") REFERENCES "public"."meal_plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_feedback" ADD CONSTRAINT "meal_feedback_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_swipe" ADD CONSTRAINT "recipe_swipe_household_id_household_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."household"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recipe_swipe" ADD CONSTRAINT "recipe_swipe_recipe_id_recipe_id_fk" FOREIGN KEY ("recipe_id") REFERENCES "public"."recipe"("id") ON DELETE cascade ON UPDATE no action;