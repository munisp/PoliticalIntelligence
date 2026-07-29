-- 0002_reconciliation: close migration drift (audit gap #1).
-- Every table in db/schema.ts that was previously provisioned out-of-band
-- (drizzle-kit push) now has a CREATE TABLE in migrations. CREATE TABLEs
-- are guarded with IF NOT EXISTS; additive ALTERs on pre-existing tables
-- are guarded via information_schema so the file is safe to re-apply.
-- (Each PREPARE wraps exactly one statement — mysql2 runs breakpoints
-- sequentially on one connection, so the session variables persist.)

-- Helper: PREPARE accepts a single statement only, so batches separated
-- by '; ' are executed one statement at a time via this procedure.
DROP PROCEDURE IF EXISTS _exec_batch;--> statement-breakpoint
CREATE PROCEDURE _exec_batch(IN batch TEXT)
BEGIN
  DECLARE cur TEXT;
  DECLARE remainder TEXT DEFAULT batch;
  WHILE remainder IS NOT NULL AND LENGTH(remainder) > 0 DO
    IF LOCATE('; ', remainder) > 0 THEN
      SET cur = SUBSTRING(remainder, 1, LOCATE('; ', remainder) - 1);
      SET remainder = SUBSTRING(remainder, LOCATE('; ', remainder) + 2);
    ELSE
      SET cur = remainder;
      SET remainder = NULL;
    END IF;
    SET @one = cur;
    PREPARE s FROM @one;
    EXECUTE s;
    DEALLOCATE PREPARE s;
  END WHILE;
END;--> statement-breakpoint

/* ---------- Column reconciliation for pre-existing tables ---------- */

-- provenance columns (origin / source_url / fetched_at) on the five
-- tables created by 0000 without them
SET @alters := (
  SELECT GROUP_CONCAT(CONCAT('ALTER TABLE `', t, '` ', adds) SEPARATOR '; ') FROM (
    SELECT x.t,
           GROUP_CONCAT(CONCAT('ADD ', c.coldef) ORDER BY c.ord SEPARATOR ', ') AS adds
      FROM (SELECT 'admin_units' AS t UNION SELECT 'jurisdictions' UNION SELECT 'opportunities'
            UNION SELECT 'sector_metrics' UNION SELECT 'evidence_sources') x
      JOIN (
            SELECT 'origin' AS colname, '`origin` varchar(8) NOT NULL DEFAULT ''seed''' AS coldef, 1 AS ord
            UNION SELECT 'source_url', '`source_url` text', 2
            UNION SELECT 'fetched_at', '`fetched_at` timestamp NULL', 3
           ) c
        ON NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                        WHERE ic.table_schema = DATABASE() AND ic.table_name = x.t AND ic.column_name = c.colname)
     GROUP BY x.t
  ) q
);--> statement-breakpoint
CALL _exec_batch(COALESCE(@alters, 'SELECT 1'));--> statement-breakpoint

-- data_sources registry metadata (§16)
SET @alters := (
  SELECT CONCAT('ALTER TABLE `data_sources` ', GROUP_CONCAT(CONCAT('ADD ', c.coldef) ORDER BY c.ord SEPARATOR ', '))
    FROM (
          SELECT 'license' AS colname, '`license` varchar(255)' AS coldef, 1 AS ord
          UNION SELECT 'quality_score', '`quality_score` int', 2
          UNION SELECT 'privacy_classification', '`privacy_classification` varchar(32) NOT NULL DEFAULT ''internal''', 3
         ) c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                      WHERE ic.table_schema = DATABASE() AND ic.table_name = 'data_sources' AND ic.column_name = c.colname)
);--> statement-breakpoint
SET @sql := COALESCE(@alters, 'SELECT 1');--> statement-breakpoint
PREPARE stmt FROM @sql;--> statement-breakpoint
EXECUTE stmt;--> statement-breakpoint
DEALLOCATE PREPARE stmt;--> statement-breakpoint

-- simulation_runs DM-3 reproducibility columns
SET @alters := (
  SELECT CONCAT('ALTER TABLE `simulation_runs` ', GROUP_CONCAT(CONCAT('ADD ', c.coldef) ORDER BY c.ord SEPARATOR ', '))
    FROM (
          SELECT 'manifest' AS colname, '`manifest` json' AS coldef, 1 AS ord
          UNION SELECT 'dataset_snapshot_id', '`dataset_snapshot_id` varchar(96)', 2
          UNION SELECT 'reproducibility_hash', '`reproducibility_hash` varchar(64)', 3
         ) c
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                      WHERE ic.table_schema = DATABASE() AND ic.table_name = 'simulation_runs' AND ic.column_name = c.colname)
);--> statement-breakpoint
SET @sql := COALESCE(@alters, 'SELECT 1');--> statement-breakpoint
PREPARE stmt FROM @sql;--> statement-breakpoint
EXECUTE stmt;--> statement-breakpoint
DEALLOCATE PREPARE stmt;--> statement-breakpoint

-- budgets.tier (audit gap #2) — for databases where budgets pre-exists
SET @alters := (
  SELECT 'ALTER TABLE `budgets` ADD `tier` varchar(32)'
   WHERE EXISTS (SELECT 1 FROM information_schema.tables it
                  WHERE it.table_schema = DATABASE() AND it.table_name = 'budgets')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                      WHERE ic.table_schema = DATABASE() AND ic.table_name = 'budgets' AND ic.column_name = 'tier')
);--> statement-breakpoint
SET @sql := COALESCE(@alters, 'SELECT 1');--> statement-breakpoint
PREPARE stmt FROM @sql;--> statement-breakpoint
EXECUTE stmt;--> statement-breakpoint
DEALLOCATE PREPARE stmt;--> statement-breakpoint

/* ---------- Missing tables (were provisioned out-of-band) ---------- */

CREATE TABLE IF NOT EXISTS `audit_worm_exports` (
	`export_id` varchar(64) NOT NULL,
	`file_name` varchar(255) NOT NULL,
	`from_event_id` bigint,
	`to_event_id` bigint,
	`event_count` int NOT NULL DEFAULT 0,
	`chain_head` varchar(64) NOT NULL,
	`manifest_sha256` varchar(64) NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `audit_worm_exports_export_id` PRIMARY KEY(`export_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `budgets` (
	`budget_id` varchar(96) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`fiscal_year` int NOT NULL,
	`mda` varchar(255) NOT NULL,
	`sector_code` varchar(32),
	`appropriated_ngn` double,
	`released_ngn` double,
	`tier` varchar(32),
	`source` varchar(255),
	`origin` varchar(8) NOT NULL DEFAULT 'seed',
	`source_url` text,
	`fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `budgets_budget_id` PRIMARY KEY(`budget_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `business_registrations` (
	`registration_id` varchar(96) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`rc_number` varchar(32),
	`entity_type` varchar(64),
	`registered_at` varchar(32),
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`lga` varchar(128),
	`source` varchar(255),
	`origin` varchar(8) NOT NULL DEFAULT 'seed',
	`source_url` text,
	`fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `business_registrations_registration_id` PRIMARY KEY(`registration_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `event_dlq` (
	`event_id` varchar(64) NOT NULL,
	`topic` varchar(128) NOT NULL,
	`dlq_topic` varchar(160) NOT NULL,
	`partition_key` varchar(128),
	`payload` json NOT NULL,
	`attempts` int NOT NULL DEFAULT 0,
	`last_error` text,
	`consumer_group` varchar(128),
	`dead_at` timestamp NOT NULL DEFAULT (now()),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`replayed_at` timestamp,
	CONSTRAINT `event_dlq_event_id` PRIMARY KEY(`event_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `facilities` (
	`facility_id` varchar(96) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`type` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`lat` double,
	`lon` double,
	`source` varchar(255),
	`origin` varchar(8) NOT NULL DEFAULT 'seed',
	`source_url` text,
	`fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `facilities_facility_id` PRIMARY KEY(`facility_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `geo_boundaries` (
	`unit_id` varchar(96) NOT NULL,
	`level` enum('federal','state','lga','ward') NOT NULL,
	`geojson` json NOT NULL,
	`centroid_lat` double,
	`centroid_lon` double,
	`origin` varchar(8) NOT NULL DEFAULT 'seed',
	`source_url` text,
	`fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `geo_boundaries_unit_id` PRIMARY KEY(`unit_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ingestion_runs` (
	`run_id` varchar(64) NOT NULL,
	`connector` varchar(32) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`status` enum('queued','running','succeeded','failed','canceled') NOT NULL DEFAULT 'queued',
	`records_in` int NOT NULL DEFAULT 0,
	`records_out` int NOT NULL DEFAULT 0,
	`contract_results` json,
	`error` text,
	`started_at` timestamp,
	`finished_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ingestion_runs_run_id` PRIMARY KEY(`run_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `job_heartbeats` (
	`job_id` varchar(64) NOT NULL,
	`status` varchar(32) NOT NULL,
	`ts` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `job_heartbeats_job_id` PRIMARY KEY(`job_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `officials` (
	`official_id` varchar(96) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`role` varchar(255) NOT NULL,
	`level` enum('federal','state','lga','ward') NOT NULL,
	`party` varchar(64),
	`valid_from` varchar(32),
	`valid_to` varchar(32),
	`source` varchar(255),
	`origin` varchar(8) NOT NULL DEFAULT 'seed',
	`source_url` text,
	`fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `officials_official_id` PRIMARY KEY(`official_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `outcome_observations` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`series_id` bigint unsigned NOT NULL,
	`period` varchar(7) NOT NULL,
	`value` double NOT NULL,
	`fetched_at` timestamp NOT NULL DEFAULT (now()),
	`provenance_json` json,
	CONSTRAINT `outcome_observations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `outcome_series` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`indicator_code` varchar(64) NOT NULL,
	`source` varchar(255) NOT NULL,
	`origin` enum('live','derived','seed') NOT NULL DEFAULT 'seed',
	`unit` varchar(32) NOT NULL,
	`frequency` enum('monthly','quarterly','annual') NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `outcome_series_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `procurement_records` (
	`record_id` varchar(96) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`buyer` varchar(255) NOT NULL,
	`supplier` varchar(255),
	`value_ngn` double,
	`award_date` varchar(32),
	`status` varchar(32) NOT NULL DEFAULT 'unknown',
	`ocid` varchar(128),
	`origin` varchar(8) NOT NULL DEFAULT 'seed',
	`source_url` text,
	`fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `procurement_records_record_id` PRIMARY KEY(`record_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `programs` (
	`program_id` varchar(96) NOT NULL,
	`jurisdiction_id` varchar(64) NOT NULL,
	`name` varchar(255) NOT NULL,
	`sector_code` varchar(32),
	`status` varchar(32) NOT NULL DEFAULT 'active',
	`target_jobs` int,
	`budget_id` varchar(96),
	`origin` varchar(8) NOT NULL DEFAULT 'seed',
	`source_url` text,
	`fetched_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `programs_program_id` PRIMARY KEY(`program_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `regulatory_pathways` (
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
CREATE TABLE IF NOT EXISTS `stakeholder_edges` (
	`id` serial AUTO_INCREMENT NOT NULL,
	`from_id` varchar(96) NOT NULL,
	`to_id` varchar(96) NOT NULL,
	`relation` varchar(64) NOT NULL,
	`label` varchar(255),
	CONSTRAINT `stakeholder_edges_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `stakeholders` (
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

/* ---------- Indexes for the new tables (guarded) ---------- */

SET @idx := (
  SELECT GROUP_CONCAT(stmt SEPARATOR '; ') FROM (
    SELECT CONCAT('CREATE ', IF(d.u, 'UNIQUE ', ''), 'INDEX `', d.n, '` ON `', d.t, '` (', d.cols, ')') AS stmt FROM (
      SELECT 'budgets_jur_year_idx' AS n, 'budgets' AS t, '`jurisdiction_id`,`fiscal_year`' AS cols, 0 AS u
      UNION SELECT 'business_registrations_jur_idx', 'business_registrations', '`jurisdiction_id`', 0
      UNION SELECT 'business_registrations_rc_idx', 'business_registrations', '`rc_number`', 0
      UNION SELECT 'facilities_jur_idx', 'facilities', '`jurisdiction_id`', 0
      UNION SELECT 'facilities_type_idx', 'facilities', '`type`', 0
      UNION SELECT 'facilities_lat_lon_idx', 'facilities', '`lat`,`lon`', 0
      UNION SELECT 'ingestion_runs_jur_idx', 'ingestion_runs', '`jurisdiction_id`', 0
      UNION SELECT 'ingestion_runs_connector_idx', 'ingestion_runs', '`connector`', 0
      UNION SELECT 'officials_jur_idx', 'officials', '`jurisdiction_id`', 0
      UNION SELECT 'outcome_observations_series_period', 'outcome_observations', '`series_id`,`period`', 1
      UNION SELECT 'outcome_observations_series_idx', 'outcome_observations', '`series_id`', 0
      UNION SELECT 'outcome_series_jur_indicator_src', 'outcome_series', '`jurisdiction_id`,`indicator_code`,`source`,`frequency`', 1
      UNION SELECT 'outcome_series_jur_idx', 'outcome_series', '`jurisdiction_id`', 0
      UNION SELECT 'procurement_records_jur_idx', 'procurement_records', '`jurisdiction_id`', 0
      UNION SELECT 'procurement_records_ocid_idx', 'procurement_records', '`ocid`', 0
      UNION SELECT 'programs_jur_idx', 'programs', '`jurisdiction_id`', 0
      UNION SELECT 'regulatory_pathways_sector_idx', 'regulatory_pathways', '`sector`', 0
      UNION SELECT 'stakeholder_edges_from_idx', 'stakeholder_edges', '`from_id`', 0
      UNION SELECT 'stakeholder_edges_to_idx', 'stakeholder_edges', '`to_id`', 0
      UNION SELECT 'stakeholders_kind_idx', 'stakeholders', '`kind`', 0
    ) d
    WHERE NOT EXISTS (SELECT 1 FROM information_schema.statistics s
                       WHERE s.table_schema = DATABASE() AND s.table_name = d.t AND s.index_name = d.n)
  ) q
);--> statement-breakpoint
CALL _exec_batch(COALESCE(@idx, 'SELECT 1'));--> statement-breakpoint
DROP PROCEDURE IF EXISTS _exec_batch;--> statement-breakpoint
