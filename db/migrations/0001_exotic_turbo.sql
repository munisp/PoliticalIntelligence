ALTER TABLE `clauses` ADD `heading` varchar(256);--> statement-breakpoint
ALTER TABLE `clauses` ADD `grounding` json;--> statement-breakpoint
ALTER TABLE `laws` ADD `evidence_base` json;--> statement-breakpoint
ALTER TABLE `laws` ADD `ria_annex` json;--> statement-breakpoint
ALTER TABLE `policy_documents` ADD `metadata` json;--> statement-breakpoint
ALTER TABLE `policy_documents` ADD `origin` varchar(8) DEFAULT 'seed' NOT NULL;--> statement-breakpoint
ALTER TABLE `policy_documents` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `policy_documents` ADD `fetched_at` timestamp;
