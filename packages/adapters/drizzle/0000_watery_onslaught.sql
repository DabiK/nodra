CREATE TABLE `app_config` (
	`id` integer PRIMARY KEY NOT NULL,
	`global_manager_prompt` text DEFAULT '' NOT NULL,
	`prompt_composition_schema_version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ck_app_config_singleton" CHECK("app_config"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `blob` (
	`id` text PRIMARY KEY NOT NULL,
	`sha256` text NOT NULL,
	`relative_path` text NOT NULL,
	`mime_type` text,
	`byte_size` integer NOT NULL,
	`created_at` text NOT NULL,
	`tombstoned_at` text,
	CONSTRAINT "ck_blob_sha256" CHECK(length("blob"."sha256") = 64),
	CONSTRAINT "ck_blob_byte_size" CHECK("blob"."byte_size" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `blob_sha256_unique` ON `blob` (`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `blob_relative_path_unique` ON `blob` (`relative_path`);--> statement-breakpoint
CREATE TABLE `project_agent_defaults` (
	`project_id` text PRIMARY KEY NOT NULL,
	`provider_id` text,
	`model_id` text,
	`reasoning_effort` text,
	`provider_options_schema_version` integer DEFAULT 1 NOT NULL,
	`provider_options_json` text DEFAULT '{}' NOT NULL,
	`permission_preset` text DEFAULT 'full_access' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_project_defaults_json" CHECK(json_valid("project_agent_defaults"."provider_options_json")),
	CONSTRAINT "ck_project_defaults_permission" CHECK("project_agent_defaults"."permission_preset" in ('read_only','workspace','full_access'))
);
--> statement-breakpoint
CREATE TABLE `project_repository` (
	`project_id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repository_id`) REFERENCES `repository`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_repository_repository_id_unique` ON `project_repository` (`repository_id`);--> statement-breakpoint
CREATE TABLE `project` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ck_project_kind" CHECK("project"."kind" in ('repo','scratch'))
);
--> statement-breakpoint
CREATE TABLE `repository` (
	`id` text PRIMARY KEY NOT NULL,
	`stable_identity` text NOT NULL,
	`canonical_remote` text,
	`initial_path` text NOT NULL,
	`current_path` text NOT NULL,
	`discovered_at` text NOT NULL,
	`moved_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_stable_identity_unique` ON `repository` (`stable_identity`);--> statement-breakpoint
CREATE TABLE `schema_migration` (
	`version` integer PRIMARY KEY NOT NULL,
	`checksum` text NOT NULL,
	`applied_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `schema_migration_checksum_unique` ON `schema_migration` (`checksum`);--> statement-breakpoint
CREATE TABLE `workspace_git_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`reason` text NOT NULL,
	`head` text,
	`tree_digest` text,
	`branch_name` text,
	`captured_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_workspace_git_snapshot` ON `workspace_git_snapshot` (`workspace_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `workspace_repository` (
	`workspace_id` text PRIMARY KEY NOT NULL,
	`repository_id` text NOT NULL,
	`base_ref` text,
	`head_ref` text,
	`branch_name` text,
	`integration_target_ref` text,
	`tombstoned_at` text,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`repository_id`) REFERENCES `repository`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`tombstoned_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_workspace_kind" CHECK("workspace"."kind" in ('repo','scratch','worktree')),
	CONSTRAINT "ck_workspace_state" CHECK("workspace"."state" in ('ready','in_use','pending_delete','deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_path_unique` ON `workspace` (`path`);--> statement-breakpoint
CREATE TABLE `approval` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`mission_id` text,
	`manager_id` text,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`expires_at` text,
	`decided_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manager_id`) REFERENCES `manager`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_approval_state" CHECK("approval"."state" in ('pending','approved','denied','expired')),
	CONSTRAINT "ck_approval_subject" CHECK((("approval"."run_id" is not null) + ("approval"."mission_id" is not null) + ("approval"."manager_id" is not null)) = 1)
);
--> statement-breakpoint
CREATE TABLE `artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`blob_id` text NOT NULL,
	`evidence_id` text,
	`artifact_kind` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`blob_id`) REFERENCES `blob`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artifact_blob_id_unique` ON `artifact` (`blob_id`);--> statement-breakpoint
CREATE TABLE `budget_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`budget_window_id` text,
	`usage_kind` text NOT NULL,
	`units` integer NOT NULL,
	`cost_micros` integer,
	`provider_usage_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`budget_window_id`) REFERENCES `budget_window`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_budget_ledger_usage_kind" CHECK("budget_ledger"."usage_kind" in ('reported','estimated','unavailable')),
	CONSTRAINT "ck_budget_ledger_units" CHECK("budget_ledger"."units" >= 0),
	CONSTRAINT "ck_budget_ledger_cost" CHECK("budget_ledger"."cost_micros" is null or "budget_ledger"."cost_micros" >= 0),
	CONSTRAINT "ck_budget_ledger_json" CHECK(json_valid("budget_ledger"."provider_usage_json"))
);
--> statement-breakpoint
CREATE INDEX `idx_budget_ledger_run` ON `budget_ledger` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `budget_override` (
	`id` text PRIMARY KEY NOT NULL,
	`budget_window_id` text NOT NULL,
	`approval_id` text NOT NULL,
	`units_delta` integer NOT NULL,
	`expires_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`budget_window_id`) REFERENCES `budget_window`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_id`) REFERENCES `approval`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `budget_window` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text,
	`period` text NOT NULL,
	`enforcement` text DEFAULT 'confirmable' NOT NULL,
	`soft_limit_units` integer NOT NULL,
	`hard_limit_units` integer,
	`active_from` text NOT NULL,
	`active_until` text,
	CONSTRAINT "ck_budget_scope" CHECK("budget_window"."scope" in ('global','mission')),
	CONSTRAINT "ck_budget_period" CHECK("budget_window"."period" in ('week','mission_lifetime')),
	CONSTRAINT "ck_budget_enforcement" CHECK("budget_window"."enforcement" in ('confirmable','absolute')),
	CONSTRAINT "ck_budget_soft_limit" CHECK("budget_window"."soft_limit_units" >= 0),
	CONSTRAINT "ck_budget_hard_limit" CHECK("budget_window"."hard_limit_units" is null or "budget_window"."hard_limit_units" >= "budget_window"."soft_limit_units"),
	CONSTRAINT "ck_budget_scope_period" CHECK(("budget_window"."scope" = 'global' and "budget_window"."scope_id" is null and "budget_window"."period" = 'week') or ("budget_window"."scope" = 'mission' and "budget_window"."scope_id" is not null and "budget_window"."period" = 'mission_lifetime')),
	CONSTRAINT "ck_budget_enforcement_limit" CHECK(("budget_window"."enforcement" = 'confirmable' and "budget_window"."hard_limit_units" is null) or "budget_window"."enforcement" = 'absolute')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_budget_window_scope` ON `budget_window` (`scope`,coalesce(`scope_id`, ''),`period`,`active_from`);--> statement-breakpoint
CREATE TABLE `concurrency_lease` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_id` text NOT NULL,
	`run_id` text NOT NULL,
	`acquired_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`released_at` text,
	FOREIGN KEY (`policy_id`) REFERENCES `concurrency_policy`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `concurrency_lease_run_id_unique` ON `concurrency_lease` (`run_id`);--> statement-breakpoint
CREATE TABLE `concurrency_policy` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scope_id` text,
	`max_active` integer NOT NULL,
	CONSTRAINT "ck_concurrency_scope" CHECK("concurrency_policy"."scope" in ('global','project','provider')),
	CONSTRAINT "ck_concurrency_max_active" CHECK("concurrency_policy"."max_active" > 0),
	CONSTRAINT "ck_concurrency_subject" CHECK(("concurrency_policy"."scope" = 'global' and "concurrency_policy"."scope_id" is null) or ("concurrency_policy"."scope" in ('project','provider') and "concurrency_policy"."scope_id" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_concurrency_policy_scope` ON `concurrency_policy` (`scope`,coalesce(`scope_id`, ''));--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`subject_digest` text NOT NULL,
	`collector_id` text NOT NULL,
	`collector_version` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_evidence_kind" CHECK("evidence"."kind" in ('declaration','observation','validation')),
	CONSTRAINT "ck_evidence_payload" CHECK(json_valid("evidence"."payload_json"))
);
--> statement-breakpoint
CREATE TABLE `evidence_blob` (
	`evidence_id` text NOT NULL,
	`blob_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`evidence_id`, `blob_id`, `role`),
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blob_id`) REFERENCES `blob`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_evidence_blob_role" CHECK("evidence_blob"."role" in ('stdout','stderr','report','output','other'))
);
--> statement-breakpoint
CREATE TABLE `gate_binding` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_id` text NOT NULL,
	`pipeline_edge_id` text,
	`pipeline_node_id` text,
	`mission_id` text,
	FOREIGN KEY (`gate_id`) REFERENCES `gate_definition`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_edge_id`) REFERENCES `pipeline_edge`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_node_id`) REFERENCES `pipeline_node`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_gate_binding_subject" CHECK(("gate_binding"."pipeline_edge_id" is not null and "gate_binding"."pipeline_node_id" is null and "gate_binding"."mission_id" is null) or ("gate_binding"."pipeline_edge_id" is null and "gate_binding"."pipeline_node_id" is not null and "gate_binding"."mission_id" is null) or ("gate_binding"."pipeline_edge_id" is null and "gate_binding"."pipeline_node_id" is null and "gate_binding"."mission_id" is not null))
);
--> statement-breakpoint
CREATE TABLE `gate_definition` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`evaluator_id` text NOT NULL,
	`evaluator_version` text NOT NULL,
	`criteria_schema_version` integer NOT NULL,
	`criteria_json` text NOT NULL,
	`expected_evidence_json` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "ck_gate_criteria_json" CHECK(json_valid("gate_definition"."criteria_json")),
	CONSTRAINT "ck_gate_expected_evidence_json" CHECK(json_valid("gate_definition"."expected_evidence_json"))
);
--> statement-breakpoint
CREATE TABLE `gate_evaluation_evidence` (
	`evaluation_id` text NOT NULL,
	`evidence_id` text NOT NULL,
	`role` text NOT NULL,
	PRIMARY KEY(`evaluation_id`, `evidence_id`),
	FOREIGN KEY (`evaluation_id`) REFERENCES `gate_evaluation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`evidence_id`) REFERENCES `evidence`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `gate_evaluation` (
	`id` text PRIMARY KEY NOT NULL,
	`gate_binding_id` text NOT NULL,
	`run_id` text,
	`evaluator_id` text NOT NULL,
	`evaluator_version` text NOT NULL,
	`state` text NOT NULL,
	`evaluated_at` text NOT NULL,
	`stale_at` text,
	`rationale` text,
	FOREIGN KEY (`gate_binding_id`) REFERENCES `gate_binding`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_gate_evaluation_state" CHECK("gate_evaluation"."state" in ('pending','passed','failed','stale','overridden'))
);
--> statement-breakpoint
CREATE INDEX `idx_gate_evaluation` ON `gate_evaluation` (`gate_binding_id`,`state`,`evaluated_at`);--> statement-breakpoint
CREATE TABLE `gate_override` (
	`id` text PRIMARY KEY NOT NULL,
	`evaluation_id` text NOT NULL,
	`approval_id` text NOT NULL,
	`decision` text NOT NULL,
	`comment` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`evaluation_id`) REFERENCES `gate_evaluation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_id`) REFERENCES `approval`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_gate_override_decision" CHECK("gate_override"."decision" in ('accept','reject','waive'))
);
--> statement-breakpoint
CREATE TABLE `manager_creation_request` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_manager_id` text NOT NULL,
	`child_manager_id` text,
	`approval_id` text,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_manager_id`) REFERENCES `manager`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`child_manager_id`) REFERENCES `manager`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approval_id`) REFERENCES `approval`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_manager_creation_state" CHECK("manager_creation_request"."state" in ('pending','approved','denied','created'))
);
--> statement-breakpoint
CREATE TABLE `mcp_selection_member` (
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`mcp_id` text NOT NULL,
	`mode` text NOT NULL,
	`config_digest` text,
	PRIMARY KEY(`owner_kind`, `owner_id`, `mcp_id`),
	CONSTRAINT "ck_mcp_member_mode" CHECK("mcp_selection_member"."mode" in ('enable','disable')),
	CONSTRAINT "ck_mcp_member_digest" CHECK("mcp_selection_member"."config_digest" is null or length("mcp_selection_member"."config_digest") = 64)
);
--> statement-breakpoint
CREATE TABLE `mcp_selection` (
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`selection_mode` text NOT NULL,
	PRIMARY KEY(`owner_kind`, `owner_id`),
	CONSTRAINT "ck_mcp_selection_owner" CHECK("mcp_selection"."owner_kind" in ('global','project','mission','manager')),
	CONSTRAINT "ck_mcp_selection_mode" CHECK("mcp_selection"."selection_mode" in ('all','none','custom','inherit'))
);
--> statement-breakpoint
CREATE TABLE `permission_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`approval_id` text NOT NULL,
	`action_kind` text NOT NULL,
	`target_digest` text NOT NULL,
	`scope` text NOT NULL,
	`run_id` text,
	`mission_id` text,
	`expires_at` text,
	`decision` text NOT NULL,
	`consumed_at` text,
	`consumed_by_event_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`approval_id`) REFERENCES `approval`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_permission_target_digest" CHECK(length("permission_grant"."target_digest") = 64),
	CONSTRAINT "ck_permission_scope" CHECK("permission_grant"."scope" in ('once','run','mission')),
	CONSTRAINT "ck_permission_decision" CHECK("permission_grant"."decision" in ('approved','denied')),
	CONSTRAINT "ck_permission_subject" CHECK((("permission_grant"."scope" in ('once','run')) and "permission_grant"."run_id" is not null and "permission_grant"."mission_id" is null) or ("permission_grant"."scope" = 'mission' and "permission_grant"."mission_id" is not null and "permission_grant"."run_id" is null))
);
--> statement-breakpoint
CREATE TABLE `run_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`agent_declaration` text,
	`observation_summary` text,
	`result_state` text NOT NULL,
	`accepted_at` text,
	`decision_comment` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_run_delivery_state" CHECK("run_delivery"."result_state" in ('pending','delivered','accepted','changes_requested','rejected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_delivery_run_id_unique` ON `run_delivery` (`run_id`);--> statement-breakpoint
CREATE TABLE `business_audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`aggregate_kind` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`command_id` text,
	`event_type` text NOT NULL,
	`actor` text NOT NULL,
	`payload_json` text NOT NULL,
	`occurred_at` text NOT NULL,
	CONSTRAINT "ck_business_audit_payload" CHECK(json_valid("business_audit_event"."payload_json"))
);
--> statement-breakpoint
CREATE INDEX `idx_audit_aggregate` ON `business_audit_event` (`aggregate_kind`,`aggregate_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `inbox` (
	`consumer` text NOT NULL,
	`message_id` text NOT NULL,
	`processed_at` text NOT NULL,
	PRIMARY KEY(`consumer`, `message_id`)
);
--> statement-breakpoint
CREATE TABLE `outbox` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	`published_at` text,
	CONSTRAINT "ck_outbox_payload" CHECK(json_valid("outbox"."payload_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_dedupe_key_unique` ON `outbox` (`dedupe_key`);--> statement-breakpoint
CREATE TABLE `relay_item` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text,
	`pipeline_run_id` text,
	`queue` text NOT NULL,
	`state` text NOT NULL,
	`reason_code` text NOT NULL,
	`created_at` text NOT NULL,
	`read_at` text,
	`snoozed_until` text,
	`resolved_at` text,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_relay_queue" CHECK("relay_item"."queue" in ('ready','active','blocked','decision_required')),
	CONSTRAINT "ck_relay_state" CHECK("relay_item"."state" in ('unread','read','snoozed','resolved')),
	CONSTRAINT "ck_relay_subject" CHECK(("relay_item"."mission_id" is not null and "relay_item"."pipeline_run_id" is null) or ("relay_item"."mission_id" is null and "relay_item"."pipeline_run_id" is not null))
);
--> statement-breakpoint
CREATE INDEX `idx_relay_queue` ON `relay_item` (`queue`,`state`,`snoozed_until`,`created_at`);--> statement-breakpoint
CREATE TABLE `retention_policy` (
	`id` integer PRIMARY KEY NOT NULL,
	`automatic_purge_enabled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ck_retention_policy_singleton" CHECK("retention_policy"."id" = 1),
	CONSTRAINT "ck_retention_no_auto_purge" CHECK("retention_policy"."automatic_purge_enabled" = 0)
);
--> statement-breakpoint
CREATE TABLE `retention_tombstone` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`deleted_at` text NOT NULL,
	`restored_at` text,
	`purge_requested_at` text,
	`purged_at` text,
	`purge_state` text NOT NULL,
	CONSTRAINT "ck_retention_purge_state" CHECK("retention_tombstone"."purge_state" in ('soft_deleted','restored','purged'))
);
--> statement-breakpoint
CREATE TABLE `search_document_registry` (
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	PRIMARY KEY(`entity_kind`, `entity_id`)
);
--> statement-breakpoint
CREATE TABLE `handover` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_node_run_id` text NOT NULL,
	`from_run_id` text,
	`to_node_run_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pipeline_node_run_id`) REFERENCES `pipeline_node_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_node_run_id`) REFERENCES `pipeline_node_run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_handover_payload" CHECK(json_valid("handover"."payload_json"))
);
--> statement-breakpoint
CREATE TABLE `manager_supervision` (
	`id` text PRIMARY KEY NOT NULL,
	`manager_id` text NOT NULL,
	`mission_id` text,
	`pipeline_id` text,
	`relation` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`manager_id`) REFERENCES `manager`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipeline`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_manager_supervision_relation" CHECK("manager_supervision"."relation" in ('created','supervises')),
	CONSTRAINT "ck_manager_supervision_subject" CHECK(("manager_supervision"."mission_id" is not null and "manager_supervision"."pipeline_id" is null) or ("manager_supervision"."mission_id" is null and "manager_supervision"."pipeline_id" is not null))
);
--> statement-breakpoint
CREATE TABLE `pipeline_definition` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`version` integer NOT NULL,
	`definition_state` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipeline`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_pipeline_definition_state" CHECK("pipeline_definition"."definition_state" in ('draft','published','superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_pipeline_definition_version` ON `pipeline_definition` (`pipeline_id`,`version`);--> statement-breakpoint
CREATE TABLE `pipeline_edge` (
	`id` text PRIMARY KEY NOT NULL,
	`definition_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`to_node_id` text NOT NULL,
	FOREIGN KEY (`definition_id`) REFERENCES `pipeline_definition`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_node_id`) REFERENCES `pipeline_node`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_node_id`) REFERENCES `pipeline_node`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_pipeline_edge_distinct" CHECK("pipeline_edge"."from_node_id" <> "pipeline_edge"."to_node_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_pipeline_edge` ON `pipeline_edge` (`definition_id`,`from_node_id`,`to_node_id`);--> statement-breakpoint
CREATE TABLE `pipeline_node_run` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_run_id` text NOT NULL,
	`node_id` text NOT NULL,
	`mission_id` text,
	`state` text NOT NULL,
	`user_attempt` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`pipeline_run_id`) REFERENCES `pipeline_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`node_id`) REFERENCES `pipeline_node`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_pipeline_node_run_state" CHECK("pipeline_node_run"."state" in ('pending','ready','active','blocked','completed','failed','skipped'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_pipeline_node_run_attempt` ON `pipeline_node_run` (`pipeline_run_id`,`node_id`,`user_attempt`);--> statement-breakpoint
CREATE TABLE `pipeline_node` (
	`id` text PRIMARY KEY NOT NULL,
	`definition_id` text NOT NULL,
	`mission_id` text,
	`node_key` text NOT NULL,
	`start_mode` text NOT NULL,
	FOREIGN KEY (`definition_id`) REFERENCES `pipeline_definition`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_pipeline_node_start_mode" CHECK("pipeline_node"."start_mode" in ('auto','human'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_pipeline_node_key` ON `pipeline_node` (`definition_id`,`node_key`);--> statement-breakpoint
CREATE TABLE `pipeline_run` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_id` text NOT NULL,
	`definition_id` text NOT NULL,
	`state` text NOT NULL,
	`temporal_workflow_id` text,
	`started_at` text,
	`ended_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pipeline_id`) REFERENCES `pipeline`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`definition_id`) REFERENCES `pipeline_definition`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_pipeline_run_state" CHECK("pipeline_run"."state" in ('queued','active','blocked','completed','failed','cancelled','archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pipeline_run_temporal_workflow_id_unique` ON `pipeline_run` (`temporal_workflow_id`);--> statement-breakpoint
CREATE TABLE `pipeline` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	`archived_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_pipeline_state" CHECK("pipeline"."state" in ('draft','active','completed','archived'))
);
--> statement-breakpoint
CREATE TABLE `targeted_retry` (
	`id` text PRIMARY KEY NOT NULL,
	`pipeline_node_run_id` text NOT NULL,
	`prior_run_id` text,
	`new_run_id` text,
	`requested_by` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`pipeline_node_run_id`) REFERENCES `pipeline_node_run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prior_run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`new_run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversation_attachment` (
	`conversation_item_id` text NOT NULL,
	`blob_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`conversation_item_id`, `ordinal`),
	FOREIGN KEY (`conversation_item_id`) REFERENCES `conversation_item`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blob_id`) REFERENCES `blob`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversation_item` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`delivery_state` text NOT NULL,
	`body` text,
	`provider_item_ref` text,
	`created_at` text NOT NULL,
	`acknowledged_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_conversation_item_kind" CHECK("conversation_item"."kind" in ('user','assistant','tool','system','steer','result')),
	CONSTRAINT "ck_conversation_delivery_state" CHECK("conversation_item"."delivery_state" in ('draft','queued','sent','acknowledged','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_conversation_item_ordinal` ON `conversation_item` (`conversation_id`,`ordinal`);--> statement-breakpoint
CREATE INDEX `idx_conversation_item` ON `conversation_item` (`conversation_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `conversation_queue` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`item_id` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`dispatched_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`item_id`) REFERENCES `conversation_item`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_conversation_queue_mode" CHECK("conversation_queue"."mode" in ('immediate','enqueue')),
	CONSTRAINT "ck_conversation_queue_state" CHECK("conversation_queue"."state" in ('queued','dispatched','acknowledged','failed','cancelled'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_queue_item_id_unique` ON `conversation_queue` (`item_id`);--> statement-breakpoint
CREATE TABLE `conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text,
	`manager_id` text,
	`provider_id` text NOT NULL,
	`provider_session_ref` text,
	`state` text NOT NULL,
	`created_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manager_id`) REFERENCES `manager`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_conversation_subject" CHECK(("conversation"."mission_id" is not null and "conversation"."manager_id" is null) or ("conversation"."mission_id" is null and "conversation"."manager_id" is not null)),
	CONSTRAINT "ck_conversation_state" CHECK("conversation"."state" in ('open','idle','closed','deleted'))
);
--> statement-breakpoint
CREATE TABLE `provider_event` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text NOT NULL,
	`source_at` text,
	`received_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_provider_event_sequence" CHECK("provider_event"."sequence" >= 0),
	CONSTRAINT "ck_provider_event_payload" CHECK(json_valid("provider_event"."payload_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_provider_event_sequence` ON `provider_event` (`run_id`,`sequence`);--> statement-breakpoint
CREATE TABLE `run_config_snapshot` (
	`run_id` text PRIMARY KEY NOT NULL,
	`resolution_schema_version` integer NOT NULL,
	`provider_id_requested` text NOT NULL,
	`provider_id_resolved` text NOT NULL,
	`model_id_requested` text,
	`model_id_resolved` text NOT NULL,
	`reasoning_effort_requested` text,
	`reasoning_effort_resolved` text,
	`provider_options_schema_version` integer NOT NULL,
	`provider_options_json` text NOT NULL,
	`provider_capabilities_json` text NOT NULL,
	`prompt_kind` text NOT NULL,
	`prompt_composition_schema_version` integer NOT NULL,
	`prompt_effective` text NOT NULL,
	`prompt_global` text,
	`prompt_manager_instruction` text,
	`prompt_mission` text,
	`prompt_brief` text,
	`permission_preset` text NOT NULL,
	`budget_snapshot_json` text NOT NULL,
	`workspace_id` text,
	`cwd` text NOT NULL,
	`git_head` text,
	`git_tree` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_run_config_options_json" CHECK(json_valid("run_config_snapshot"."provider_options_json")),
	CONSTRAINT "ck_run_config_capabilities_json" CHECK(json_valid("run_config_snapshot"."provider_capabilities_json")),
	CONSTRAINT "ck_run_config_prompt_kind" CHECK("run_config_snapshot"."prompt_kind" in ('mission','manager')),
	CONSTRAINT "ck_run_config_permission" CHECK("run_config_snapshot"."permission_preset" in ('read_only','workspace','full_access')),
	CONSTRAINT "ck_run_config_budget_json" CHECK(json_valid("run_config_snapshot"."budget_snapshot_json"))
);
--> statement-breakpoint
CREATE TABLE `run_input_snapshot_attachment` (
	`run_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`blob_id` text NOT NULL,
	`display_name` text NOT NULL,
	PRIMARY KEY(`run_id`, `ordinal`),
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blob_id`) REFERENCES `blob`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_run_attachment_ordinal" CHECK("run_input_snapshot_attachment"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE `run_snapshot_mcp` (
	`run_id` text NOT NULL,
	`mcp_id` text NOT NULL,
	`config_digest` text NOT NULL,
	`transport_kind` text NOT NULL,
	PRIMARY KEY(`run_id`, `mcp_id`),
	FOREIGN KEY (`run_id`) REFERENCES `run`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_run_mcp_digest" CHECK(length("run_snapshot_mcp"."config_digest") = 64)
);
--> statement-breakpoint
CREATE TABLE `run` (
	`id` text PRIMARY KEY NOT NULL,
	`mission_id` text,
	`manager_id` text,
	`conversation_id` text NOT NULL,
	`user_attempt` integer NOT NULL,
	`state` text NOT NULL,
	`temporal_workflow_id` text NOT NULL,
	`temporal_run_id` text,
	`provider_id` text NOT NULL,
	`model_id` text NOT NULL,
	`reasoning_effort` text,
	`provider_run_ref` text,
	`started_at` text,
	`ended_at` text,
	`duration_ms` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`cache_write_tokens` integer,
	`cost_micros` integer,
	`usage_kind` text,
	`pricing_snapshot_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`manager_id`) REFERENCES `manager`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversation`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_run_attempt" CHECK("run"."user_attempt" > 0),
	CONSTRAINT "ck_run_state" CHECK("run"."state" in ('QUEUED','STARTING','RUNNING','WAITING_APPROVAL','CANCELLING','SUCCEEDED','FAILED','CANCELLED','UNKNOWN')),
	CONSTRAINT "ck_run_subject" CHECK(("run"."mission_id" is not null and "run"."manager_id" is null) or ("run"."mission_id" is null and "run"."manager_id" is not null)),
	CONSTRAINT "ck_run_duration" CHECK("run"."duration_ms" is null or "run"."duration_ms" >= 0),
	CONSTRAINT "ck_run_input_tokens" CHECK("run"."input_tokens" is null or "run"."input_tokens" >= 0),
	CONSTRAINT "ck_run_output_tokens" CHECK("run"."output_tokens" is null or "run"."output_tokens" >= 0),
	CONSTRAINT "ck_run_cache_read" CHECK("run"."cache_read_tokens" is null or "run"."cache_read_tokens" >= 0),
	CONSTRAINT "ck_run_cache_write" CHECK("run"."cache_write_tokens" is null or "run"."cache_write_tokens" >= 0),
	CONSTRAINT "ck_run_cost" CHECK("run"."cost_micros" is null or "run"."cost_micros" >= 0),
	CONSTRAINT "ck_run_usage_kind" CHECK("run"."usage_kind" is null or "run"."usage_kind" in ('reported','estimated','unavailable')),
	CONSTRAINT "ck_run_pricing_json" CHECK("run"."pricing_snapshot_json" is null or json_valid("run"."pricing_snapshot_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `run_temporal_workflow_id_unique` ON `run` (`temporal_workflow_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_run_mission_attempt` ON `run` (`mission_id`,`user_attempt`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_run_manager_attempt` ON `run` (`manager_id`,`user_attempt`);--> statement-breakpoint
CREATE INDEX `idx_run_subject` ON `run` (`mission_id`,`manager_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_run_provider_model` ON `run` (`provider_id`,`model_id`,`reasoning_effort`,`created_at`);--> statement-breakpoint
CREATE TABLE `manager_brief` (
	`id` text PRIMARY KEY NOT NULL,
	`manager_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`manager_id`) REFERENCES `manager`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_manager_brief_status" CHECK("manager_brief"."status" in ('current','superseded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_manager_brief_version` ON `manager_brief` (`manager_id`,`version`);--> statement-breakpoint
CREATE TABLE `manager_input_attachment` (
	`manager_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`blob_id` text NOT NULL,
	`display_name` text NOT NULL,
	PRIMARY KEY(`manager_id`, `ordinal`),
	FOREIGN KEY (`manager_id`) REFERENCES `manager`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blob_id`) REFERENCES `blob`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_manager_attachment_ordinal" CHECK("manager_input_attachment"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE `manager_instruction_version` (
	`manager_id` text NOT NULL,
	`version` integer NOT NULL,
	`instruction` text NOT NULL,
	`is_current` integer NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`manager_id`, `version`),
	FOREIGN KEY (`manager_id`) REFERENCES `manager`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_manager_instruction_current" CHECK("manager_instruction_version"."is_current" in (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_manager_current_instruction` ON `manager_instruction_version` (`manager_id`) WHERE "manager_instruction_version"."is_current" = 1;--> statement-breakpoint
CREATE TABLE `manager` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`state` text NOT NULL,
	`temporal_parent_workflow_id` text,
	`provider_id` text,
	`model_id` text,
	`reasoning_effort` text,
	`provider_options_schema_version` integer DEFAULT 1 NOT NULL,
	`provider_options_json` text DEFAULT '{}' NOT NULL,
	`permission_preset` text DEFAULT 'full_access' NOT NULL,
	`workspace_id` text,
	`created_at` text NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspace`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_manager_state" CHECK("manager"."state" in ('draft','ready','active','blocked','archived')),
	CONSTRAINT "ck_manager_options_json" CHECK(json_valid("manager"."provider_options_json")),
	CONSTRAINT "ck_manager_permission" CHECK("manager"."permission_preset" in ('read_only','workspace','full_access'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `manager_temporal_parent_workflow_id_unique` ON `manager` (`temporal_parent_workflow_id`);--> statement-breakpoint
CREATE TABLE `mission_agent_config` (
	`mission_id` text PRIMARY KEY NOT NULL,
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
	CONSTRAINT "ck_mission_agent_config_json" CHECK(json_valid("mission_agent_config"."provider_options_json")),
	CONSTRAINT "ck_mission_agent_config_permission" CHECK("mission_agent_config"."permission_preset" is null or "mission_agent_config"."permission_preset" in ('read_only','workspace','full_access')),
	CONSTRAINT "ck_mission_auto_commit" CHECK("mission_agent_config"."auto_commit_authorized" in (0,1))
);
--> statement-breakpoint
CREATE TABLE `mission_input_attachment` (
	`mission_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`blob_id` text NOT NULL,
	`display_name` text NOT NULL,
	PRIMARY KEY(`mission_id`, `ordinal`),
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`blob_id`) REFERENCES `blob`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_mission_attachment_ordinal" CHECK("mission_input_attachment"."ordinal" >= 0)
);
--> statement-breakpoint
CREATE TABLE `mission` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`title` text NOT NULL,
	`execution_kind` text NOT NULL,
	`state` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`temporal_parent_workflow_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `project`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_mission_title" CHECK(length(trim("mission"."title")) > 0),
	CONSTRAINT "ck_mission_execution_kind" CHECK("mission"."execution_kind" in ('human','agent')),
	CONSTRAINT "ck_mission_state" CHECK("mission"."state" in ('DRAFT','READY','ACTIVE','BLOCKED','VALIDATION','DONE','ABANDONED')),
	CONSTRAINT "ck_mission_version" CHECK("mission"."version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mission_temporal_parent_workflow_id_unique` ON `mission` (`temporal_parent_workflow_id`);--> statement-breakpoint
CREATE INDEX `idx_mission_relay` ON `mission` (`state`,`updated_at`);
--> statement-breakpoint
CREATE VIRTUAL TABLE search_document USING fts5(entity_kind UNINDEXED,entity_id UNINDEXED,title,body, tokenize='unicode61');
--> statement-breakpoint
CREATE TRIGGER run_subject_matches_conversation BEFORE INSERT ON run BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM conversation c WHERE c.id=NEW.conversation_id AND ((NEW.mission_id IS NOT NULL AND c.mission_id=NEW.mission_id AND c.manager_id IS NULL) OR (NEW.manager_id IS NOT NULL AND c.manager_id=NEW.manager_id AND c.mission_id IS NULL))) THEN RAISE(ABORT,'run subject must match conversation subject') END;
END;
--> statement-breakpoint
CREATE TRIGGER mcp_owner_exists BEFORE INSERT ON mcp_selection BEGIN
  SELECT CASE WHEN NEW.owner_kind='global' AND NEW.owner_id<>'global' THEN RAISE(ABORT,'global MCP owner must be global') WHEN NEW.owner_kind='project' AND NOT EXISTS(SELECT 1 FROM project WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing project MCP owner') WHEN NEW.owner_kind='mission' AND NOT EXISTS(SELECT 1 FROM mission WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing mission MCP owner') WHEN NEW.owner_kind='manager' AND NOT EXISTS(SELECT 1 FROM manager WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing manager MCP owner') END;
END;
--> statement-breakpoint
CREATE TRIGGER mcp_owner_update_exists BEFORE UPDATE OF owner_kind,owner_id ON mcp_selection BEGIN
  SELECT CASE WHEN NEW.owner_kind='global' AND NEW.owner_id<>'global' THEN RAISE(ABORT,'global MCP owner must be global') WHEN NEW.owner_kind='project' AND NOT EXISTS(SELECT 1 FROM project WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing project MCP owner') WHEN NEW.owner_kind='mission' AND NOT EXISTS(SELECT 1 FROM mission WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing mission MCP owner') WHEN NEW.owner_kind='manager' AND NOT EXISTS(SELECT 1 FROM manager WHERE id=NEW.owner_id) THEN RAISE(ABORT,'missing manager MCP owner') END;
END;
--> statement-breakpoint
CREATE TRIGGER mcp_member_owner_exists BEFORE INSERT ON mcp_selection_member BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mcp_selection s WHERE s.owner_kind=NEW.owner_kind AND s.owner_id=NEW.owner_id) THEN RAISE(ABORT,'missing MCP selection owner') END;
END;
--> statement-breakpoint
CREATE TRIGGER mcp_member_owner_update_exists BEFORE UPDATE OF owner_kind,owner_id ON mcp_selection_member BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mcp_selection s WHERE s.owner_kind=NEW.owner_kind AND s.owner_id=NEW.owner_id) THEN RAISE(ABORT,'missing MCP selection owner') END;
END;
--> statement-breakpoint
CREATE TRIGGER published_pipeline_immutable BEFORE UPDATE ON pipeline_definition WHEN OLD.definition_state='published' BEGIN SELECT RAISE(ABORT,'published pipeline definition is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER published_pipeline_not_deleted BEFORE DELETE ON pipeline_definition WHEN OLD.definition_state='published' BEGIN SELECT RAISE(ABORT,'published pipeline definition is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER pipeline_edge_same_definition BEFORE INSERT ON pipeline_edge BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pipeline_node n WHERE n.id=NEW.from_node_id AND n.definition_id=NEW.definition_id) OR NOT EXISTS(SELECT 1 FROM pipeline_node n WHERE n.id=NEW.to_node_id AND n.definition_id=NEW.definition_id) THEN RAISE(ABORT,'edge nodes must belong to definition') END;
END;
--> statement-breakpoint
CREATE TRIGGER pipeline_run_definition_matches BEFORE INSERT ON pipeline_run BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pipeline_definition d WHERE d.id=NEW.definition_id AND d.pipeline_id=NEW.pipeline_id) THEN RAISE(ABORT,'pipeline run definition must belong to pipeline') END;
END;
--> statement-breakpoint
CREATE TRIGGER pipeline_node_run_definition_matches BEFORE INSERT ON pipeline_node_run BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM pipeline_run r JOIN pipeline_node n ON n.id=NEW.node_id WHERE r.id=NEW.pipeline_run_id AND n.definition_id=r.definition_id) THEN RAISE(ABORT,'node must belong to pipeline run definition') END;
END;
--> statement-breakpoint
CREATE TRIGGER manager_current_instruction_exists BEFORE INSERT ON manager BEGIN
  SELECT CASE WHEN NEW.state IN('ready','active') AND NOT EXISTS(SELECT 1 FROM manager_instruction_version i WHERE i.manager_id=NEW.id AND i.is_current=1) THEN RAISE(ABORT,'ready manager requires current instruction') END;
END;
--> statement-breakpoint
CREATE TRIGGER manager_ready_requires_instruction BEFORE UPDATE OF state ON manager WHEN NEW.state IN('ready','active') BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM manager_instruction_version i WHERE i.manager_id=NEW.id AND i.is_current=1) THEN RAISE(ABORT,'ready manager requires current instruction') END;
END;
--> statement-breakpoint
CREATE TRIGGER mission_config_only_for_agent BEFORE INSERT ON mission_agent_config BEGIN
  SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM mission m WHERE m.id=NEW.mission_id AND m.execution_kind='agent') THEN RAISE(ABORT,'human mission cannot have agent config') END;
END;
