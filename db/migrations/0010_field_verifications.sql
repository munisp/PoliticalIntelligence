CREATE TABLE `field_verifications` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`verification_id` varchar(96) NOT NULL,
	`entity_type` varchar(32) NOT NULL,
	`entity_ref` varchar(255) NOT NULL,
	`verifier_id` bigint unsigned NOT NULL,
	`gps_lat` double NOT NULL,
	`gps_lng` double NOT NULL,
	`photo_uri` varchar(512),
	`verdict` enum('confirmed','disputed','needs_review') NOT NULL,
	`notes` text,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `field_verifications_id` PRIMARY KEY(`id`),
	CONSTRAINT `field_verifications_verification_id_unique` UNIQUE(`verification_id`)
);
--> statement-breakpoint
CREATE INDEX `field_verifications_entity_idx` ON `field_verifications` (`entity_type`,`entity_ref`);
