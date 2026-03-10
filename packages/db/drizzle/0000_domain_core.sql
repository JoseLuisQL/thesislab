CREATE TABLE `theses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`slug` text NOT NULL,
	`degree_program` text NOT NULL,
	`institution` text NOT NULL,
	`workspace_path` text NOT NULL,
	`default_language` text NOT NULL,
	`current_state` text NOT NULL,
	`latest_status_at` text NOT NULL,
	`next_step_summary` text NOT NULL,
	`active_import_id` text,
	`active_build_run_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX `theses_slug_idx` ON `theses` (`slug`);

CREATE TABLE `thesis_states` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`state` text NOT NULL,
	`source` text NOT NULL,
	`status_summary` text NOT NULL,
	`blockers_json` text DEFAULT '[]' NOT NULL,
	`transitioned_from` text,
	`transitioned_at` text NOT NULL,
	`is_current` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `workflow_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`parent_task_id` text,
	`title` text NOT NULL,
	`intent` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`due_at` text,
	`active_checkpoint_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_task_id`) REFERENCES `workflow_tasks`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE TABLE `workflow_task_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`task_id` text NOT NULL,
	`label` text NOT NULL,
	`summary` text NOT NULL,
	`progress_percent` integer DEFAULT 0 NOT NULL,
	`blocker` text,
	`checkpointed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `workflow_tasks`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `workflow_packs` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`current_step_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`workflow_pack_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text NOT NULL,
	`step_order` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workflow_pack_id`) REFERENCES `workflow_packs`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`label` text,
	`note` text,
	`scope` text NOT NULL,
	`reason` text NOT NULL,
	`snapshot_path` text,
	`created_by` text NOT NULL,
	`checkpointed_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `feedback_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`source_type` text NOT NULL,
	`body` text NOT NULL,
	`summary` text,
	`recorded_at` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `intake_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`source_format` text NOT NULL,
	`status` text NOT NULL,
	`import_root_path` text NOT NULL,
	`detected_entrypoint` text,
	`report_json` text DEFAULT '{}' NOT NULL,
	`warnings_json` text DEFAULT '[]' NOT NULL,
	`recommendations_json` text DEFAULT '[]' NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `normalized_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`intake_job_id` text,
	`parent_node_id` text,
	`node_type` text NOT NULL,
	`title` text,
	`content` text,
	`ordinal` integer NOT NULL,
	`source_path` text,
	`source_start` text,
	`source_end` text,
	`provenance_kind` text NOT NULL,
	`provenance_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`intake_job_id`) REFERENCES `intake_jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_node_id`) REFERENCES `normalized_nodes`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`source_type` text NOT NULL,
	`title` text NOT NULL,
	`authors_json` text DEFAULT '[]' NOT NULL,
	`publication_year` integer,
	`locator` text,
	`status` text NOT NULL,
	`ingest_metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `evidence_fragments` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`source_id` text NOT NULL,
	`normalized_node_id` text,
	`task_id` text,
	`locator` text,
	`snippet` text NOT NULL,
	`extraction_method` text NOT NULL,
	`confidence` real,
	`status` text NOT NULL,
	`provenance_json` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`normalized_node_id`) REFERENCES `normalized_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`task_id`) REFERENCES `workflow_tasks`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE TABLE `claims` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`normalized_node_id` text,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`support_summary` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`normalized_node_id`) REFERENCES `normalized_nodes`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE TABLE `claim_evidence_links` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`claim_id` text NOT NULL,
	`evidence_fragment_id` text NOT NULL,
	`rationale` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_fragment_id`) REFERENCES `evidence_fragments`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `claim_evidence_links_unique_idx` ON `claim_evidence_links` (`claim_id`,`evidence_fragment_id`);

CREATE TABLE `zotero_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`normalized_node_id` text,
	`source_id` text,
	`scope` text NOT NULL,
	`library_id` text NOT NULL,
	`collection_key` text,
	`item_key` text,
	`normalized_data_json` text DEFAULT '{}' NOT NULL,
	`connector_status` text NOT NULL,
	`last_synced_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`normalized_node_id`) REFERENCES `normalized_nodes`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE TABLE `policy_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`institution` text NOT NULL,
	`faculty` text NOT NULL,
	`version` text NOT NULL,
	`title` text NOT NULL,
	`required_sections_json` text DEFAULT '[]' NOT NULL,
	`rule_definitions_json` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `compliance_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`policy_profile_id` text NOT NULL,
	`status` text NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`evaluated_rule_count` integer DEFAULT 0 NOT NULL,
	`warning_rule_count` integer DEFAULT 0 NOT NULL,
	`skipped_rule_count` integer DEFAULT 0 NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_profile_id`) REFERENCES `policy_profiles`(`id`) ON UPDATE no action ON DELETE restrict
);

CREATE TABLE `compliance_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`compliance_run_id` text NOT NULL,
	`policy_profile_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`normalized_node_id` text,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`remediation` text,
	`disposition` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`compliance_run_id`) REFERENCES `compliance_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`policy_profile_id`) REFERENCES `policy_profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`normalized_node_id`) REFERENCES `normalized_nodes`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE TABLE `academic_qa_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`status` text NOT NULL,
	`assessed_scope_json` text DEFAULT '{}' NOT NULL,
	`skipped_scope_json` text DEFAULT '{}' NOT NULL,
	`summary_json` text DEFAULT '{}' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `academic_qa_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`academic_qa_run_id` text NOT NULL,
	`claim_id` text,
	`normalized_node_id` text,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`rationale` text NOT NULL,
	`remediation` text,
	`triggering_condition` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`academic_qa_run_id`) REFERENCES `academic_qa_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`claim_id`) REFERENCES `claims`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`normalized_node_id`) REFERENCES `normalized_nodes`(`id`) ON UPDATE no action ON DELETE set null
);

CREATE TABLE `build_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`thesis_id` text NOT NULL,
	`checkpoint_id` text,
	`status` text NOT NULL,
	`engine` text NOT NULL,
	`artifact_path` text,
	`diagnostics_json` text DEFAULT '{}' NOT NULL,
	`bibliography_status` text DEFAULT 'unknown' NOT NULL,
	`started_at` text NOT NULL,
	`completed_at` text,
	`is_latest_successful` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`thesis_id`) REFERENCES `theses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE set null
);
