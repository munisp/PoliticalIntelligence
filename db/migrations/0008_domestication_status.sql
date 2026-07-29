CREATE TABLE `domestication_status` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`law_ref` varchar(128) NOT NULL,
	`state` varchar(32) NOT NULL,
	`status` enum('not_started','in_assembly','passed','domesticated','rejected') NOT NULL DEFAULT 'not_started',
	`bill_ref` varchar(128),
	`evidence_ref` varchar(512),
	`origin` enum('live','derived','seed') NOT NULL DEFAULT 'derived',
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `domestication_status_id` PRIMARY KEY(`id`),
	CONSTRAINT `domestication_law_state` UNIQUE(`law_ref`,`state`)
);
--> statement-breakpoint
CREATE INDEX `domestication_state_idx` ON `domestication_status` (`state`);
