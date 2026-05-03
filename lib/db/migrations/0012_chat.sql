CREATE TABLE IF NOT EXISTS "chat_messages" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "username" text NOT NULL,
  "message" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "chat_banned_words" (
  "id" serial PRIMARY KEY NOT NULL,
  "phrase" text NOT NULL UNIQUE,
  "created_at" timestamptz DEFAULT now() NOT NULL
);
