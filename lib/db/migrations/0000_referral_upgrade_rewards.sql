-- Task #24: Referral Upgrade Reward System
-- Additive migration: adds USDT balance columns to users and creates
-- referral_earnings table with FK constraints.
-- Safe to run against existing databases (all changes are additive).

ALTER TABLE "users" ADD COLUMN "usdt_balance" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_usdt_balance" real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE TABLE "referral_earnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_id" integer NOT NULL,
	"referred_id" integer NOT NULL,
	"upgrade_id" integer NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"reward_coins" real DEFAULT 0 NOT NULL,
	"reward_locked_usdt" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'locked' NOT NULL,
	"unlock_date" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_referred_id_users_id_fk" FOREIGN KEY ("referred_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referral_earnings" ADD CONSTRAINT "referral_earnings_upgrade_id_upgrades_id_fk" FOREIGN KEY ("upgrade_id") REFERENCES "public"."upgrades"("id") ON DELETE no action ON UPDATE no action;
