CREATE TABLE "trivia_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" integer NOT NULL,
	"entry_fee" real NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trivia_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"player1_id" integer NOT NULL,
	"player2_id" integer,
	"challenge_id" integer,
	"entry_fee" real NOT NULL,
	"question_ids" jsonb NOT NULL,
	"player1_answers" jsonb DEFAULT '[]' NOT NULL,
	"player2_answers" jsonb DEFAULT '[]' NOT NULL,
	"player1_score" integer DEFAULT 0 NOT NULL,
	"player2_score" integer DEFAULT 0 NOT NULL,
	"winner_id" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "trivia_questions" (
	"id" serial PRIMARY KEY NOT NULL,
	"question" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct_index" integer NOT NULL,
	"category" text NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trivia_challenges" ADD CONSTRAINT "trivia_challenges_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_games" ADD CONSTRAINT "trivia_games_player1_id_users_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_games" ADD CONSTRAINT "trivia_games_player2_id_users_id_fk" FOREIGN KEY ("player2_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_games" ADD CONSTRAINT "trivia_games_challenge_id_trivia_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."trivia_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trivia_games" ADD CONSTRAINT "trivia_games_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;