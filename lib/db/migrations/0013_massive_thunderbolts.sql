CREATE TABLE "chat_banned_words" (
	"id" serial PRIMARY KEY NOT NULL,
	"phrase" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_banned_words_phrase_unique" UNIQUE("phrase")
);
--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"username" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"sender_role" text NOT NULL,
	"message" text,
	"image_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"is_resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "trivia_challenges" ADD COLUMN "category" text DEFAULT 'All' NOT NULL;--> statement-breakpoint
CREATE INDEX "support_messages_user_id_created_at_idx" ON "support_messages" USING btree ("user_id","created_at");