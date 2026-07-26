CREATE TABLE `provider_catalog_snapshot` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`catalog_version` text NOT NULL,
	`adapter_version` text NOT NULL,
	`binary_version` text,
	`authenticated` integer NOT NULL,
	`auth_kind` text,
	`capabilities_json` text NOT NULL,
	`models_json` text NOT NULL,
	`probed_at` text NOT NULL,
	CONSTRAINT "ck_provider_catalog_authenticated" CHECK("provider_catalog_snapshot"."authenticated" in (0,1)),
	CONSTRAINT "ck_provider_catalog_capabilities" CHECK(json_valid("provider_catalog_snapshot"."capabilities_json")),
	CONSTRAINT "ck_provider_catalog_models" CHECK(json_valid("provider_catalog_snapshot"."models_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_provider_catalog_version` ON `provider_catalog_snapshot` (`provider_id`,`catalog_version`);--> statement-breakpoint
CREATE INDEX `idx_provider_catalog_latest` ON `provider_catalog_snapshot` (`provider_id`,`probed_at`);