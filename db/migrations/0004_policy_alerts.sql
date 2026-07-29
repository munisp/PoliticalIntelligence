CREATE TABLE `policy_alerts` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`alert_id` varchar(128) NOT NULL,
	`jurisdiction_id` varchar(64),
	`sector` varchar(64) NOT NULL,
	`source_entity` enum('bill','regulation','budget') NOT NULL,
	`source_ref` varchar(255) NOT NULL,
	`title` varchar(512) NOT NULL,
	`summary` text,
	`impact_score` double NOT NULL,
	`matched_stakeholders` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`origin` enum('live','derived','seed') NOT NULL DEFAULT 'derived',
	CONSTRAINT `policy_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `policy_alerts_alert_id_unique` UNIQUE(`alert_id`)
);
--> statement-breakpoint
CREATE TABLE `regulatory_pathways` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`pathway_id` varchar(96) NOT NULL,
	`sector` varchar(64) NOT NULL,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`jurisdiction_scope` enum('federal','state','both') NOT NULL,
	`licenses` json,
	`constraints` json,
	`supporting_law_refs` json,
	`association_refs` json,
	`steps` json,
	`origin` enum('live','derived','seed') NOT NULL DEFAULT 'derived',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `regulatory_pathways_id` PRIMARY KEY(`id`),
	CONSTRAINT `regulatory_pathways_pathway_id_unique` UNIQUE(`pathway_id`)
);
--> statement-breakpoint
CREATE TABLE `stakeholder_edges` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`from_id` varchar(96) NOT NULL,
	`to_id` varchar(96) NOT NULL,
	`relation` varchar(64) NOT NULL,
	`label` varchar(255),
	CONSTRAINT `stakeholder_edges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stakeholders` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`stakeholder_id` varchar(96) NOT NULL,
	`kind` enum('individual','committee','ministry','agency','association','state_body','development_partner') NOT NULL,
	`name` varchar(255) NOT NULL,
	`title` varchar(255),
	`org` varchar(255),
	`state` varchar(64),
	`chamber` varchar(64),
	`sector_tags` json,
	`bio` text,
	`influence_area` text,
	`lobby_angle` text,
	`contact_note` text,
	`related_sectors` json,
	`as_of` varchar(10),
	`origin` enum('live','derived','seed') NOT NULL DEFAULT 'derived',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stakeholders_id` PRIMARY KEY(`id`),
	CONSTRAINT `stakeholders_stakeholder_id_unique` UNIQUE(`stakeholder_id`)
);
--> statement-breakpoint
CREATE INDEX `policy_alerts_sector_idx` ON `policy_alerts` (`sector`);--> statement-breakpoint
CREATE INDEX `policy_alerts_jur_idx` ON `policy_alerts` (`jurisdiction_id`);--> statement-breakpoint
CREATE INDEX `regulatory_pathways_sector_idx` ON `regulatory_pathways` (`sector`);--> statement-breakpoint
CREATE INDEX `stakeholder_edges_from_idx` ON `stakeholder_edges` (`from_id`);--> statement-breakpoint
CREATE INDEX `stakeholder_edges_to_idx` ON `stakeholder_edges` (`to_id`);--> statement-breakpoint
CREATE INDEX `stakeholders_kind_idx` ON `stakeholders` (`kind`);
