CREATE TABLE `provider_session_link` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_session_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`mode` text NOT NULL,
	`attached_at` text NOT NULL,
	`detached_at` text,
	FOREIGN KEY (`provider_session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_provider_session_link_mode" CHECK("provider_session_link"."mode" = 'read_only')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_provider_session_link_active` ON `provider_session_link` (`provider_session_id`) WHERE "provider_session_link"."detached_at" is null;--> statement-breakpoint
CREATE INDEX `idx_provider_session_link_mission` ON `provider_session_link` (`mission_id`);--> statement-breakpoint
CREATE TABLE `provider_session` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`external_session_ref` text NOT NULL,
	`ownership` text NOT NULL,
	`first_observed_at` text NOT NULL,
	`last_observed_at` text NOT NULL,
	CONSTRAINT "ck_provider_session_provider" CHECK(length(trim("provider_session"."provider_id")) > 0),
	CONSTRAINT "ck_provider_session_external_ref" CHECK(length("provider_session"."external_session_ref") > 0),
	CONSTRAINT "ck_provider_session_ownership" CHECK("provider_session"."ownership" = 'external_observed')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_provider_session_provider_ref` ON `provider_session` (`provider_id`,`external_session_ref`);
