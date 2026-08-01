PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_provider_session_link` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_session_id` text NOT NULL,
	`mission_id` text NOT NULL,
	`mode` text NOT NULL,
	`attached_at` text NOT NULL,
	`detached_at` text,
	FOREIGN KEY (`provider_session_id`) REFERENCES `provider_session`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ck_provider_session_link_mode" CHECK("__new_provider_session_link"."mode" in ('read_only', 'control'))
);
--> statement-breakpoint
INSERT INTO `__new_provider_session_link`("id", "provider_session_id", "mission_id", "mode", "attached_at", "detached_at") SELECT "id", "provider_session_id", "mission_id", "mode", "attached_at", "detached_at" FROM `provider_session_link`;--> statement-breakpoint
DROP TABLE `provider_session_link`;--> statement-breakpoint
ALTER TABLE `__new_provider_session_link` RENAME TO `provider_session_link`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `ux_provider_session_link_active` ON `provider_session_link` (`provider_session_id`) WHERE "provider_session_link"."detached_at" is null;--> statement-breakpoint
CREATE INDEX `idx_provider_session_link_mission` ON `provider_session_link` (`mission_id`);