CREATE TABLE `mission_tag` (
	`mission_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`mission_id`, `tag_id`),
	FOREIGN KEY (`mission_id`) REFERENCES `mission`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`color` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "ck_tag_label" CHECK(length(trim("tag"."label")) > 0),
	CONSTRAINT "ck_tag_color" CHECK("tag"."color" GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ux_tag_label` ON `tag` (`label`);