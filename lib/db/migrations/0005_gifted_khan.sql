CREATE TABLE "sub_admin_permissions" (
	"sub_admin_id" integer NOT NULL,
	"module" text NOT NULL,
	"can_read" boolean DEFAULT false NOT NULL,
	"can_write" boolean DEFAULT false NOT NULL,
	CONSTRAINT "sub_admin_permissions_sub_admin_id_module_pk" PRIMARY KEY("sub_admin_id","module")
);
--> statement-breakpoint
CREATE TABLE "sub_admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sub_admins_username_unique" UNIQUE("username"),
	CONSTRAINT "sub_admins_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "mines_games" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"bet" real NOT NULL,
	"mine_count" integer NOT NULL,
	"mine_positions" jsonb NOT NULL,
	"revealed_tiles" jsonb DEFAULT '[]' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_multiplier" real DEFAULT 1 NOT NULL,
	"final_payout" real,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sub_admin_permissions" ADD CONSTRAINT "sub_admin_permissions_sub_admin_id_sub_admins_id_fk" FOREIGN KEY ("sub_admin_id") REFERENCES "public"."sub_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mines_games" ADD CONSTRAINT "mines_games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;