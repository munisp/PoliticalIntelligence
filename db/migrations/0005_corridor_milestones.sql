CREATE TABLE `corridor_milestones` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`milestone_id` varchar(96) NOT NULL,
	`corridor_id` varchar(96) NOT NULL,
	`title` varchar(255) NOT NULL,
	`planned_date` varchar(32) NOT NULL,
	`actual_date` varchar(32),
	`status` enum('planned','in_progress','done','delayed') NOT NULL DEFAULT 'planned',
	`pct_complete` double NOT NULL DEFAULT 0,
	`funding_disbursed_ngn` double,
	`evidence_ref` varchar(255),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `corridor_milestones_id` PRIMARY KEY(`id`),
	CONSTRAINT `corridor_milestones_milestone_id_unique` UNIQUE(`milestone_id`)
);
--> statement-breakpoint
CREATE INDEX `corridor_milestones_corridor_idx` ON `corridor_milestones` (`corridor_id`);
