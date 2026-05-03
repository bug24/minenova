CREATE TABLE IF NOT EXISTS "support_messages" (
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
CREATE INDEX IF NOT EXISTS "support_messages_user_id_created_at_idx" ON "support_messages" USING btree ("user_id","created_at");
