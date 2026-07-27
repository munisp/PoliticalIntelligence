CREATE TABLE `admin_units` (
	`admin_unit_id` varchar(64) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`admin_level` enum('federal','state','lga','ward') NOT NULL,
	`country_code` varchar(2) NOT NULL,
	`parent_id` varchar(64),
	`population` int,
	`source_refs` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `admin_units_admin_unit_id` PRIMARY KEY(`admin_unit_id`)
);
--> statement-breakpoint
CREATE TABLE `approval_events` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(128) NOT NULL,
	`from_state` varchar(32) NOT NULL,
	`to_state` varchar(32) NOT NULL,
	`actor_id` bigint unsigned NOT NULL,
	`comment` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `approval_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `assumption_sets` (
	`assumptions_set_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`entries` json NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assumption_sets_assumptions_set_id` PRIMARY KEY(`assumptions_set_id`)
);
--> statement-breakpoint
CREATE TABLE `audit_events` (
	`event_id` serial AUTO_INCREMENT NOT NULL,
	`actor_id` bigint unsigned,
	`action` varchar(128) NOT NULL,
	`entity_type` varchar(64) NOT NULL,
	`entity_id` varchar(128) NOT NULL,
	`scopes` json,
	`request_id` varchar(64),
	`correlation_id` varchar(64),
	`payload` json,
	`prev_hash` varchar(64),
	`entry_hash` varchar(64),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_events_event_id` PRIMARY KEY(`event_id`)
);
--> statement-breakpoint
CREATE TABLE `briefs` (
	`brief_id` varchar(64) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`template` varchar(64) NOT NULL,
	`title` varchar(512) NOT NULL,
	`review_state` enum('draft','in_review','approved','signed_off','returned') NOT NULL DEFAULT 'draft',
	`content` json,
	`model_routing` json,
	`request_id` varchar(64),
	`created_by` bigint unsigned,
	`approved_by` bigint unsigned,
	`signed_off_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `briefs_brief_id` PRIMARY KEY(`brief_id`)
);
--> statement-breakpoint
CREATE TABLE `citations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`from_clause_id` varchar(96) NOT NULL,
	`to_clause_id` varchar(96) NOT NULL,
	`relation` enum('CITES','ENABLES','RESTRICTS','APPLIES_TO','ADMINISTERED_BY') NOT NULL,
	`target_meta` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `citations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `clauses` (
	`clause_id` varchar(96) NOT NULL,
	`law_id` varchar(64) NOT NULL,
	`section_path` varchar(128) NOT NULL,
	`text` text NOT NULL,
	`language` varchar(8) NOT NULL DEFAULT 'en',
	`confidence` double NOT NULL DEFAULT 0.9,
	`review_state` enum('draft','in_review','approved','signed_off','returned') NOT NULL DEFAULT 'draft',
	`obligations` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `clauses_clause_id` PRIMARY KEY(`clause_id`)
);
--> statement-breakpoint
CREATE TABLE `data_sources` (
	`source_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`owner` varchar(255),
	`url` varchar(512),
	`category` varchar(64),
	`access_method` varchar(64),
	`refresh_cadence` varchar(64),
	`ingestion_pattern` varchar(64),
	`health` enum('healthy','stale','failing') NOT NULL DEFAULT 'healthy',
	`last_refresh` timestamp,
	`freshness_days` int NOT NULL DEFAULT 0,
	`contract_compliance` json,
	`geography_scope` varchar(128),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `data_sources_source_id` PRIMARY KEY(`source_id`)
);
--> statement-breakpoint
CREATE TABLE `event_outbox` (
	`event_id` varchar(64) NOT NULL,
	`topic` varchar(128) NOT NULL,
	`partition_key` varchar(128),
	`payload` json NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`delivered_at` timestamp,
	CONSTRAINT `event_outbox_event_id` PRIMARY KEY(`event_id`)
);
--> statement-breakpoint
CREATE TABLE `evidence_sources` (
	`evidence_source_id` varchar(96) NOT NULL,
	`source_type` enum('sql','vector','graph','document') NOT NULL,
	`citation` text NOT NULL,
	`retrieval_path` varchar(512),
	`confidence` double NOT NULL DEFAULT 0.5,
	`content_excerpt` text,
	`linked_entity_ids` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `evidence_sources_evidence_source_id` PRIMARY KEY(`evidence_source_id`)
);
--> statement-breakpoint
CREATE TABLE `interventions` (
	`intervention_id` varchar(64) NOT NULL,
	`opportunity_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`instrument_type` varchar(64),
	`estimated_cost` double,
	`expected_jobs` int,
	`timeline_months` int,
	`evidence_refs` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `interventions_intervention_id` PRIMARY KEY(`intervention_id`)
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`job_id` varchar(64) NOT NULL,
	`type` varchar(64) NOT NULL,
	`status` enum('queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'queued',
	`progress` int NOT NULL DEFAULT 0,
	`input` json,
	`result` json,
	`error` text,
	`idempotency_key` varchar(128),
	`actor_id` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`finished_at` timestamp,
	CONSTRAINT `jobs_job_id` PRIMARY KEY(`job_id`),
	CONSTRAINT `jobs_idempotency_key_idx` UNIQUE(`idempotency_key`)
);
--> statement-breakpoint
CREATE TABLE `jurisdictions` (
	`jurisdiction_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`admin_level` enum('federal','state','lga','ward') NOT NULL,
	`country_code` varchar(2) NOT NULL,
	`parent_id` varchar(64),
	`valid_from` timestamp,
	`source_refs` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `jurisdictions_jurisdiction_id` PRIMARY KEY(`jurisdiction_id`)
);
--> statement-breakpoint
CREATE TABLE `laws` (
	`law_id` varchar(64) NOT NULL,
	`title` varchar(512) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`category` varchar(64),
	`status` varchar(32) NOT NULL DEFAULT 'in_force',
	`year` int,
	`source_uri` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `laws_law_id` PRIMARY KEY(`law_id`)
);
--> statement-breakpoint
CREATE TABLE `opportunities` (
	`opportunity_id` varchar(64) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`sector_code` varchar(32) NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`score` double NOT NULL DEFAULT 0,
	`confidence` double NOT NULL DEFAULT 0.5,
	`estimated_jobs_min` int,
	`estimated_jobs_max` int,
	`budget_min` double,
	`budget_max` double,
	`horizon_months` int,
	`review_state` enum('draft','in_review','approved','signed_off','returned') NOT NULL DEFAULT 'draft',
	`evidence_refs` json,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `opportunities_opportunity_id` PRIMARY KEY(`opportunity_id`)
);
--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`pipeline_id` varchar(64) NOT NULL,
	`source_id` varchar(64) NOT NULL,
	`status` enum('queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'queued',
	`started_at` timestamp,
	`finished_at` timestamp,
	`rows_processed` int NOT NULL DEFAULT 0,
	`error` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pipeline_runs_pipeline_id` PRIMARY KEY(`pipeline_id`)
);
--> statement-breakpoint
CREATE TABLE `policy_documents` (
	`document_id` varchar(64) NOT NULL,
	`title` varchar(512) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`language` varchar(8) NOT NULL DEFAULT 'en',
	`source_uri` text,
	`hash` varchar(128),
	`review_state` enum('draft','in_review','approved','signed_off','returned') NOT NULL DEFAULT 'draft',
	`doc_type` varchar(64),
	`ocr_confidence` double,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `policy_documents_document_id` PRIMARY KEY(`document_id`)
);
--> statement-breakpoint
CREATE TABLE `recommendations` (
	`recommendation_id` varchar(64) NOT NULL,
	`opportunity_id` varchar(64),
	`scenario_id` varchar(64),
	`contract` json NOT NULL,
	`review_state` enum('draft','in_review','approved','signed_off','returned') NOT NULL DEFAULT 'draft',
	`approval_chain` json,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `recommendations_recommendation_id` PRIMARY KEY(`recommendation_id`)
);
--> statement-breakpoint
CREATE TABLE `review_tasks` (
	`task_id` varchar(64) NOT NULL,
	`type` enum('ocr_low_confidence','legal_extract','data_quality') NOT NULL,
	`entity_ref` varchar(128) NOT NULL,
	`assignee_role` varchar(32) NOT NULL,
	`status` varchar(32) NOT NULL DEFAULT 'open',
	`payload` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `review_tasks_task_id` PRIMARY KEY(`task_id`)
);
--> statement-breakpoint
CREATE TABLE `scenario_templates` (
	`template_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`config` json NOT NULL,
	`author_jurisdiction` varchar(64),
	`installs` int NOT NULL DEFAULT 0,
	`rating` double NOT NULL DEFAULT 0,
	`published_state` varchar(32) NOT NULL DEFAULT 'draft',
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scenario_templates_template_id` PRIMARY KEY(`template_id`)
);
--> statement-breakpoint
CREATE TABLE `scenarios` (
	`scenario_id` varchar(64) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`intervention_ids` json,
	`assumptions_set_id` varchar(64),
	`model_plan` json,
	`status` varchar(32) NOT NULL DEFAULT 'draft',
	`version` int NOT NULL DEFAULT 1,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `scenarios_scenario_id` PRIMARY KEY(`scenario_id`)
);
--> statement-breakpoint
CREATE TABLE `sector_metrics` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`sector_code` varchar(32) NOT NULL,
	`metric_key` varchar(64) NOT NULL,
	`value` double NOT NULL,
	`period` varchar(16) NOT NULL,
	`confidence` double NOT NULL DEFAULT 0.5,
	`source_id` varchar(64),
	CONSTRAINT `sector_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sector_multipliers` (
	`sector_code` varchar(32) NOT NULL,
	`direct` double NOT NULL,
	`indirect` double NOT NULL,
	`induced` double NOT NULL,
	`source` varchar(255) NOT NULL,
	`confidence` double NOT NULL DEFAULT 0.5,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sector_multipliers_sector_code` PRIMARY KEY(`sector_code`)
);
--> statement-breakpoint
CREATE TABLE `sectors` (
	`sector_code` varchar(32) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	CONSTRAINT `sectors_sector_code` PRIMARY KEY(`sector_code`)
);
--> statement-breakpoint
CREATE TABLE `simulation_runs` (
	`simulation_run_id` varchar(64) NOT NULL,
	`scenario_id` varchar(64) NOT NULL,
	`engine` varchar(32) NOT NULL,
	`execution_profile` json,
	`model_versions` json,
	`status` enum('queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'queued',
	`progress` int NOT NULL DEFAULT 0,
	`result_summary` json,
	`artifact_uri` varchar(512),
	`seed` int NOT NULL DEFAULT 42,
	`started_at` timestamp,
	`finished_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `simulation_runs_simulation_run_id` PRIMARY KEY(`simulation_run_id`)
);
--> statement-breakpoint
CREATE TABLE `twin_states` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`layer` varchar(64) NOT NULL,
	`state` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	`calibrated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `twin_states_id` PRIMARY KEY(`id`),
	CONSTRAINT `twin_states_jur_layer_idx` UNIQUE(`jurisdiction_id`,`layer`)
);
--> statement-breakpoint
CREATE TABLE `user_jurisdictions` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`access_level` enum('read','write','admin') NOT NULL DEFAULT 'read',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_jurisdictions_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_jurisdictions_user_jur_idx` UNIQUE(`user_id`,`jurisdiction_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`unionId` varchar(255) NOT NULL,
	`name` varchar(255),
	`email` varchar(320),
	`avatar` text,
	`role` enum('user','admin') NOT NULL DEFAULT 'user',
	`platformRole` varchar(32) NOT NULL DEFAULT 'policy_analyst',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()),
	`lastSignInAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_unionId_unique` UNIQUE(`unionId`)
);
--> statement-breakpoint
CREATE TABLE `webhook_subscriptions` (
	`sub_id` varchar(64) NOT NULL,
	`url` varchar(512) NOT NULL,
	`topics` json NOT NULL,
	`secret` varchar(128) NOT NULL,
	`active` int NOT NULL DEFAULT 1,
	`created_by` bigint unsigned,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `webhook_subscriptions_sub_id` PRIMARY KEY(`sub_id`)
);
--> statement-breakpoint
CREATE INDEX `admin_units_jur_idx` ON `admin_units` (`jurisdiction_id`);--> statement-breakpoint
CREATE INDEX `admin_units_parent_idx` ON `admin_units` (`parent_id`);--> statement-breakpoint
CREATE INDEX `approval_events_entity_idx` ON `approval_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_events_entity_idx` ON `audit_events` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_events_created_idx` ON `audit_events` (`created_at`);--> statement-breakpoint
CREATE INDEX `briefs_jur_idx` ON `briefs` (`jurisdiction_id`);--> statement-breakpoint
CREATE INDEX `citations_from_idx` ON `citations` (`from_clause_id`);--> statement-breakpoint
CREATE INDEX `citations_to_idx` ON `citations` (`to_clause_id`);--> statement-breakpoint
CREATE INDEX `clauses_law_idx` ON `clauses` (`law_id`);--> statement-breakpoint
CREATE INDEX `event_outbox_topic_idx` ON `event_outbox` (`topic`);--> statement-breakpoint
CREATE INDEX `event_outbox_delivered_idx` ON `event_outbox` (`delivered_at`);--> statement-breakpoint
CREATE INDEX `interventions_opp_idx` ON `interventions` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `jobs_actor_idx` ON `jobs` (`actor_id`);--> statement-breakpoint
CREATE INDEX `laws_jur_idx` ON `laws` (`jurisdiction_id`);--> statement-breakpoint
CREATE INDEX `opportunities_jur_sector_idx` ON `opportunities` (`jurisdiction_id`,`sector_code`);--> statement-breakpoint
CREATE INDEX `opportunities_score_idx` ON `opportunities` (`score`);--> statement-breakpoint
CREATE INDEX `pipeline_runs_source_idx` ON `pipeline_runs` (`source_id`);--> statement-breakpoint
CREATE INDEX `policy_documents_jur_idx` ON `policy_documents` (`jurisdiction_id`);--> statement-breakpoint
CREATE INDEX `recommendations_opp_idx` ON `recommendations` (`opportunity_id`);--> statement-breakpoint
CREATE INDEX `review_tasks_status_idx` ON `review_tasks` (`status`);--> statement-breakpoint
CREATE INDEX `scenario_templates_state_idx` ON `scenario_templates` (`published_state`);--> statement-breakpoint
CREATE INDEX `scenarios_jur_idx` ON `scenarios` (`jurisdiction_id`);--> statement-breakpoint
CREATE INDEX `sector_metrics_jur_sector_idx` ON `sector_metrics` (`jurisdiction_id`,`sector_code`);--> statement-breakpoint
CREATE INDEX `simulation_runs_scenario_idx` ON `simulation_runs` (`scenario_id`);--> statement-breakpoint
CREATE INDEX `user_jurisdictions_jur_idx` ON `user_jurisdictions` (`jurisdiction_id`);