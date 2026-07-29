CREATE TABLE `published_scenarios` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`published_id` varchar(96) NOT NULL,
	`scenario_run_id` varchar(64) NOT NULL,
	`published_by` bigint unsigned,
	`title` varchar(255) NOT NULL,
	`summary` text,
	`fork_count` int NOT NULL DEFAULT 0,
	`reproducibility_hash` varchar(64),
	`published_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `published_scenarios_id` PRIMARY KEY(`id`),
	CONSTRAINT `published_scenarios_published_id_unique` UNIQUE(`published_id`)
);
--> statement-breakpoint
CREATE INDEX `published_scenarios_run_idx` ON `published_scenarios` (`scenario_run_id`);