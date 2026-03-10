PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`workflow_pack_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`step_order` integer NOT NULL,
	`created_at` text DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')) NOT NULL,
	`updated_at` text DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')) NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_pack_id`) REFERENCES `workflow_packs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_workflow_steps`("id", "thesis_id", "workflow_pack_id", "title", "description", "status", "step_order", "created_at", "updated_at") SELECT "id", "thesis_id", "workflow_pack_id", "title", "description", "status", "step_order", "created_at", "updated_at" FROM `workflow_steps`;--> statement-breakpoint
DROP TABLE `workflow_steps`;--> statement-breakpoint
ALTER TABLE `__new_workflow_steps` RENAME TO `workflow_steps`;--> statement-breakpoint
PRAGMA foreign_keys=ON;