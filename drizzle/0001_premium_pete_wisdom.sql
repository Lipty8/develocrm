CREATE TABLE `entity_media` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`uploaded_by_user_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `tenants`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_media_active_uq` ON `entity_media` (`tenant_id`,`entity_type`,`entity_id`,`kind`);--> statement-breakpoint
CREATE INDEX `entity_media_entity_idx` ON `entity_media` (`entity_type`,`entity_id`);