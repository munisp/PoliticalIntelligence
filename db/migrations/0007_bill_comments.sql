CREATE TABLE `bill_comments` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`comment_id` varchar(96) NOT NULL,
	`law_id` varchar(64) NOT NULL,
	`user_id` bigint unsigned,
	`pseudonym` varchar(128),
	`body` text NOT NULL,
	`sentiment_hint` enum('support','oppose','neutral','suggestion') NOT NULL DEFAULT 'neutral',
	`theme_tags` json,
	`status` enum('visible','flagged','hidden') NOT NULL DEFAULT 'visible',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bill_comments_id` PRIMARY KEY(`id`),
	CONSTRAINT `bill_comments_comment_id_unique` UNIQUE(`comment_id`)
);
--> statement-breakpoint
CREATE INDEX `bill_comments_law_idx` ON `bill_comments` (`law_id`);--> statement-breakpoint
CREATE INDEX `bill_comments_status_idx` ON `bill_comments` (`status`);
