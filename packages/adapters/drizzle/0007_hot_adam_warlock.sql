PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_mission_agent_config` (
	`mission_id` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`provider_id` text,
	`model_id` text,
	`reasoning_effort` text,
	`provider_options_schema_version` integer DEFAULT 1 NOT NULL,
	`provider_options_json` text DEFAULT '{}' NOT NULL,
	`mission_prompt` text DEFAULT '' NOT NULL,
	`permission_preset` text,
	`workspace_id` text,
	`auto_commit_authorized` integer DEFAULT 0 NOT NULL,
	`integration_target_ref` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_mission_agent_config_version" CHECK("__new_mission_agent_config"."version" >= 0),
	CONSTRAINT "ck_mission_agent_config_json" CHECK(json_valid("__new_mission_agent_config"."provider_options_json")),
	CONSTRAINT "ck_mission_agent_config_permission" CHECK("__new_mission_agent_config"."permission_preset" is null or "__new_mission_agent_config"."permission_preset" in ('read_only','workspace','full_access')),
	CONSTRAINT "ck_mission_auto_commit" CHECK("__new_mission_agent_config"."auto_commit_authorized" in (0,1))
);
--> statement-breakpoint
INSERT INTO `__new_mission_agent_config`("mission_id", "version", "provider_id", "model_id", "reasoning_effort", "provider_options_schema_version", "provider_options_json", "mission_prompt", "permission_preset", "workspace_id", "auto_commit_authorized", "integration_target_ref", "updated_at") SELECT "mission_id", 0, "provider_id", "model_id", "reasoning_effort", "provider_options_schema_version", "provider_options_json", "mission_prompt", "permission_preset", "workspace_id", "auto_commit_authorized", "integration_target_ref", "updated_at" FROM `mission_agent_config`;--> statement-breakpoint
DROP TABLE `mission_agent_config`;--> statement-breakpoint
ALTER TABLE `__new_mission_agent_config` RENAME TO `mission_agent_config`;--> statement-breakpoint
CREATE TRIGGER mission_config_only_for_agent BEFORE INSERT ON mission_agent_config BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mission m WHERE m.id=NEW.mission_id AND m.execution_kind='agent') THEN RAISE(ABORT,'human mission cannot have agent config') END;
END;--> statement-breakpoint
PRAGMA foreign_keys=ON;
