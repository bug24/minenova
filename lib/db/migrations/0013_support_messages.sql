CREATE TYPE IF NOT EXISTS "support_sender_role" AS ENUM ('user', 'admin');

CREATE TABLE IF NOT EXISTS "support_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "sender_role" "support_sender_role" NOT NULL,
  "message" text,
  "image_url" text,
  "is_read" boolean DEFAULT false NOT NULL,
  "is_resolved" boolean DEFAULT false NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "support_messages_user_id_idx" ON "support_messages" ("user_id");
