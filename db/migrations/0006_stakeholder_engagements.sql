CREATE TABLE `stakeholder_engagements` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`stakeholder_id` varchar(96) NOT NULL,
	`user_id` bigint unsigned NOT NULL,
	`engaged_at` timestamp NOT NULL,
	`channel` varchar(32) NOT NULL,
	`outcome` text,
	`commitments` text,
	`next_action` text,
	`next_action_date` varchar(32),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stakeholder_engagements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `stakeholder_engagements_stk_idx` ON `stakeholder_engagements` (`stakeholder_id`);--> statement-breakpoint
CREATE INDEX `stakeholder_engagements_user_idx` ON `stakeholder_engagements` (`user_id`);