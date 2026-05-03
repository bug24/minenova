CREATE INDEX "audit_log_created_at_idx" ON "admin_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_type_idx" ON "admin_audit_log" USING btree ("actor_type");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "admin_audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_actor_username_idx" ON "admin_audit_log" USING btree ("actor_username");