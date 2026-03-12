ALTER TABLE `theses` ADD `policy_profile_id` text;
ALTER TABLE `theses` ADD `official_workspace_path` text;
ALTER TABLE `theses` ADD `official_entrypoint` text;

CREATE TABLE `citations` (
  `id` text PRIMARY KEY NOT NULL,
  `thesis_id` text NOT NULL,
  `source_id` text,
  `zotero_mapping_id` text,
  `normalized_node_id` text,
  `claim_id` text,
  `citation_key` text NOT NULL,
  `locator` text,
  `style` text DEFAULT 'bibtex' NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `created_at` text DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')) NOT NULL,
  `updated_at` text DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'NOW')) NOT NULL,
  FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`zotero_mapping_id`) REFERENCES `zotero_mappings`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`normalized_node_id`) REFERENCES `normalized_nodes`(`id`) ON UPDATE no action ON DELETE set null,
  FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE UNIQUE INDEX `citations_thesis_key_idx` ON `citations` (`thesis_id`, `citation_key`);
