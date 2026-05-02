CREATE TABLE "ludo_challenges" (
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
CREATE TABLE "ludo_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"challenge_id" integer NOT NULL,
	"red_player_id" integer NOT NULL,
	"blue_player_id" integer NOT NULL,
	"board_state" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"winner_id" integer,
	"entry_fee" real NOT NULL,
	"last_move_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ludo_moves" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"dice_value" integer NOT NULL,
	"piece_index" integer,
	"from_progress" integer,
	"to_progress" integer,
	"captured" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_suspended" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "referral_earnings_referred_upgrade_tier_uidx" ON "referral_earnings" USING btree ("referred_id","upgrade_id","tier");