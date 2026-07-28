"""DM-4 (ADR-005): Iceberg lakehouse table schemas for canonical entities.

Each canonical entity gets one Iceberg table in the `policy_twin` namespace
with a partitioned layout (partition keys are logical — applied by the
writer; PyIceberg `PartitionSpec` when pyiceberg is installed). Column types
use Iceberg primitive names so the same mapping drives both the PyIceberg
writer and the Trino smoke queries.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Column:
    name: str
    iceberg_type: str  # iceberg primitive: string/long/double/timestamp/boolean
    required: bool = False


@dataclass(frozen=True)
class TableSchema:
    entity: str
    table: str  # table name inside the namespace
    columns: tuple[Column, ...]
    partition_by: tuple[str, ...]
    updated_at_column: str = "updated_at"

    @property
    def column_names(self) -> list[str]:
        return [c.name for c in self.columns]


NAMESPACE = "policy_twin"

# Canonical entities (db/schema.ts) -> lakehouse tables. Every table keeps
# the provenance columns (source_id, ingested_at) from the canonical model.
TABLES: dict[str, TableSchema] = {
    "jurisdictions": TableSchema(
        entity="jurisdictions",
        table="jurisdictions",
        columns=(
            Column("jurisdiction_id", "string", required=True),
            Column("name", "string"),
            Column("country_code", "string"),
            Column("admin_level", "string"),
            Column("parent_id", "string"),
            Column("population", "long"),
            Column("updated_at", "timestamp", required=True),
            Column("source_id", "string"),
            Column("ingested_at", "timestamp"),
        ),
        partition_by=("country_code", "admin_level"),
    ),
    "sector_metrics": TableSchema(
        entity="sector_metrics",
        table="sector_metrics",
        columns=(
            Column("metric_id", "string", required=True),
            Column("jurisdiction_id", "string", required=True),
            Column("sector_code", "string"),
            Column("indicator", "string"),
            Column("value", "double"),
            Column("unit", "string"),
            Column("period", "string"),
            Column("updated_at", "timestamp", required=True),
            Column("source_id", "string"),
            Column("ingested_at", "timestamp"),
        ),
        partition_by=("sector_code",),
    ),
    "opportunities": TableSchema(
        entity="opportunities",
        table="opportunities",
        columns=(
            Column("opportunity_id", "string", required=True),
            Column("jurisdiction_id", "string"),
            Column("sector_code", "string"),
            Column("title", "string"),
            Column("score", "double"),
            Column("confidence", "double"),
            Column("status", "string"),
            Column("updated_at", "timestamp", required=True),
            Column("source_id", "string"),
        ),
        partition_by=("sector_code",),
    ),
    "laws": TableSchema(
        entity="laws",
        table="laws",
        columns=(
            Column("law_id", "string", required=True),
            Column("jurisdiction_id", "string"),
            Column("title", "string"),
            Column("category", "string"),
            Column("status", "string"),
            Column("enacted_date", "string"),
            Column("updated_at", "timestamp", required=True),
            Column("source_id", "string"),
        ),
        partition_by=("category",),
    ),
    "clauses": TableSchema(
        entity="clauses",
        table="clauses",
        columns=(
            Column("clause_id", "string", required=True),
            Column("law_id", "string", required=True),
            Column("clause_type", "string"),
            Column("text", "string"),
            Column("updated_at", "timestamp", required=True),
            Column("source_id", "string"),
        ),
        partition_by=("clause_type",),
    ),
    "simulation_runs": TableSchema(
        entity="simulation_runs",
        table="simulation_runs",
        columns=(
            Column("simulation_run_id", "string", required=True),
            Column("scenario_id", "string"),
            Column("engine", "string"),
            Column("status", "string"),
            Column("reproducibility_hash", "string"),
            Column("updated_at", "timestamp", required=True),
        ),
        partition_by=("engine",),
    ),
    "evidence_sources": TableSchema(
        entity="evidence_sources",
        table="evidence_sources",
        columns=(
            Column("source_id", "string", required=True),
            Column("name", "string"),
            Column("publisher", "string"),
            Column("license", "string"),
            Column("quality_score", "double"),
            Column("updated_at", "timestamp", required=True),
        ),
        partition_by=(),
    ),
    "budgets": TableSchema(
        entity="budgets",
        table="budgets",
        columns=(
            Column("budget_id", "string", required=True),
            Column("jurisdiction_id", "string"),
            Column("fiscal_year", "long"),
            Column("sector_code", "string"),
            Column("amount", "double"),
            Column("currency", "string"),
            Column("updated_at", "timestamp", required=True),
            Column("source_id", "string"),
        ),
        partition_by=("fiscal_year",),
    ),
    "facilities": TableSchema(
        entity="facilities",
        table="facilities",
        columns=(
            Column("facility_id", "string", required=True),
            Column("jurisdiction_id", "string"),
            Column("facility_type", "string"),
            Column("name", "string"),
            Column("latitude", "double"),
            Column("longitude", "double"),
            Column("updated_at", "timestamp", required=True),
            Column("source_id", "string"),
        ),
        partition_by=("facility_type",),
    ),
    "procurement_records": TableSchema(
        entity="procurement_records",
        table="procurement_records",
        columns=(
            Column("record_id", "string", required=True),
            Column("jurisdiction_id", "string"),
            Column("buyer", "string"),
            Column("supplier", "string"),
            Column("amount", "double"),
            Column("currency", "string"),
            Column("award_date", "string"),
            Column("updated_at", "timestamp", required=True),
            Column("source_id", "string"),
        ),
        partition_by=("buyer",),
    ),
}

assert set(TABLES) == {
    "jurisdictions", "sector_metrics", "opportunities", "laws", "clauses",
    "simulation_runs", "evidence_sources", "budgets", "facilities",
    "procurement_records",
}
