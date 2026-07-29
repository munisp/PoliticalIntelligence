-- budgets.tier (audit gap #2): dedicated column for the connector-emitted
-- budget tier (federal | state | faac_allocation | budget_execution |
-- development_partner). Guarded: 0002 already includes the column when it
-- creates the table fresh; this only patches pre-existing databases.
SET @alters := (
  SELECT 'ALTER TABLE `budgets` ADD `tier` varchar(32)'
   WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns ic
                      WHERE ic.table_schema = DATABASE() AND ic.table_name = 'budgets' AND ic.column_name = 'tier')
);--> statement-breakpoint
SET @sql := COALESCE(@alters, 'SELECT 1');--> statement-breakpoint
PREPARE stmt FROM @sql;--> statement-breakpoint
EXECUTE stmt;--> statement-breakpoint
DEALLOCATE PREPARE stmt;--> statement-breakpoint
