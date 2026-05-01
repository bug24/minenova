-- Task #24 hotfix: add hash_rate_boost and daily_cap_boost to upgrades table.
-- Production database was missing these columns because they were only synced
-- to dev via drizzle-kit push. Using IF NOT EXISTS so this is safe to re-run
-- against a dev database that already has the columns.

ALTER TABLE "upgrades" ADD COLUMN IF NOT EXISTS "hash_rate_boost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "upgrades" ADD COLUMN IF NOT EXISTS "daily_cap_boost" real DEFAULT 0 NOT NULL;
