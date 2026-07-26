PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_confirmation` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`target_json` text NOT NULL,
	`target_digest` text NOT NULL,
	`cwd` text,
	`provider_id` text,
	`permission_preset` text,
	`risk` text NOT NULL,
	`scope` text NOT NULL,
	`run_id` text,
	`mission_id` text,
	`workspace_id` text,
	`expires_at` text NOT NULL,
	`state` text NOT NULL,
	`decided_by` text,
	`comment` text,
	`created_at` text NOT NULL,
	`decided_at` text,
	`consumed_at` text,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_confirmation_target_digest" CHECK(length("__new_confirmation"."target_digest") = 64),
	CONSTRAINT "ck_confirmation_target_json" CHECK(json_valid("__new_confirmation"."target_json")),
	CONSTRAINT "ck_confirmation_scope" CHECK("__new_confirmation"."scope" in ('once','run','mission')),
	CONSTRAINT "ck_confirmation_state" CHECK("__new_confirmation"."state" in ('pending','approved','denied','expired','consumed')),
	CONSTRAINT "ck_confirmation_subject" CHECK(("__new_confirmation"."scope" = 'once' and (("__new_confirmation"."run_id" is not null)+("__new_confirmation"."mission_id" is not null)+("__new_confirmation"."workspace_id" is not null)) = 1) or ("__new_confirmation"."scope" = 'run' and "__new_confirmation"."run_id" is not null and "__new_confirmation"."mission_id" is null and "__new_confirmation"."workspace_id" is null) or ("__new_confirmation"."scope" = 'mission' and "__new_confirmation"."mission_id" is not null and "__new_confirmation"."run_id" is null and "__new_confirmation"."workspace_id" is null))
);
--> statement-breakpoint
INSERT INTO `__new_confirmation`("id", "action", "target_json", "target_digest", "cwd", "provider_id", "permission_preset", "risk", "scope", "run_id", "mission_id", "workspace_id", "expires_at", "state", "decided_by", "comment", "created_at", "decided_at", "consumed_at") SELECT "id", "action", "target_json", "target_digest", "cwd", "provider_id", "permission_preset", "risk", "scope", "run_id", "mission_id", "workspace_id", "expires_at", "state", "decided_by", "comment", "created_at", "decided_at", "consumed_at" FROM `confirmation`;--> statement-breakpoint
DROP TABLE `confirmation`;--> statement-breakpoint
ALTER TABLE `__new_confirmation` RENAME TO `confirmation`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `idx_confirmation_state_expires` ON `confirmation` (`state`,`expires_at`);--> statement-breakpoint
CREATE INDEX `idx_confirmation_run` ON `confirmation` (`run_id`,`action`,`state`);--> statement-breakpoint
CREATE INDEX `idx_confirmation_mission` ON `confirmation` (`mission_id`,`action`,`state`);--> statement-breakpoint
CREATE INDEX `idx_confirmation_workspace` ON `confirmation` (`workspace_id`,`action`,`state`);--> statement-breakpoint
CREATE TRIGGER confirmation_exact_fields_immutable
BEFORE UPDATE OF action,target_json,target_digest,cwd,provider_id,permission_preset,risk,scope,run_id,mission_id,workspace_id,expires_at,created_at
ON confirmation
BEGIN
  SELECT RAISE(ABORT,'confirmation exact fields are immutable');
END;--> statement-breakpoint
CREATE TRIGGER confirmation_state_transition
BEFORE UPDATE OF state ON confirmation
WHEN NOT (
  (OLD.state='pending' AND NEW.state IN('approved','denied','expired')) OR
  (OLD.state='approved' AND NEW.state IN('consumed','expired')) OR
  OLD.state=NEW.state
)
BEGIN
  SELECT RAISE(ABORT,'invalid confirmation state transition');
END;
