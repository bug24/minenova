CREATE TABLE IF NOT EXISTS "chat_mutes" (
        "id" serial PRIMARY KEY NOT NULL,
        "user_id" integer NOT NULL,
        "reason" text,
        "expires_at" timestamp with time zone,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mining_sessions" ADD COLUMN IF NOT EXISTS "boost_coins_earned_today" real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chat_mutes_user_id_idx" ON "chat_mutes" USING btree ("user_id");
