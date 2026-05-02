CREATE TABLE "whot_challenges" (
	"id" serial PRIMARY KEY NOT NULL,
	"creator_id" integer NOT NULL,
	"entry_fee" real NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"opponent_id" integer,
	"game_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "whot_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"challenge_id" integer,
	"player0_id" integer NOT NULL,
	"player1_id" integer NOT NULL,
	"game_state" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"winner_id" integer,
	"entry_fee" real NOT NULL,
	"last_move_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "whot_moves" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"action" text NOT NULL,
	"card_played" jsonb,
	"called_suit" text,
	"drew_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ludo_games" ALTER COLUMN "challenge_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "whot_challenges" ADD CONSTRAINT "whot_challenges_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whot_challenges" ADD CONSTRAINT "whot_challenges_opponent_id_users_id_fk" FOREIGN KEY ("opponent_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whot_games" ADD CONSTRAINT "whot_games_challenge_id_whot_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."whot_challenges"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whot_games" ADD CONSTRAINT "whot_games_player0_id_users_id_fk" FOREIGN KEY ("player0_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whot_games" ADD CONSTRAINT "whot_games_player1_id_users_id_fk" FOREIGN KEY ("player1_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whot_games" ADD CONSTRAINT "whot_games_winner_id_users_id_fk" FOREIGN KEY ("winner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whot_moves" ADD CONSTRAINT "whot_moves_game_id_whot_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."whot_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whot_moves" ADD CONSTRAINT "whot_moves_player_id_users_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;