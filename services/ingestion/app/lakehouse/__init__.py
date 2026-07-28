"""DM-4 (ADR-005): Iceberg lakehouse export pipeline.

Public surface:
  TABLES                    canonical entity -> lakehouse table schemas
  plan_export               incremental export planning (watermark-based)
  map_record                canonical row -> lakehouse record
  export_entity             full per-entity export driver
  TableWriter               writer protocol (PyIcebergWriter in production)
"""
from app.lakehouse.schema import NAMESPACE, TABLES, Column, TableSchema
from app.lakehouse.exporter import (
    ExportPlan,
    ExportResult,
    LocalJsonlWriter,
    PyIcebergWriter,
    TableWriter,
    apply_watermark,
    default_writer,
    export_entity,
    load_state,
    map_record,
    plan_export,
    save_state,
)

__all__ = [
    "NAMESPACE", "TABLES", "Column", "TableSchema",
    "ExportPlan", "ExportResult", "LocalJsonlWriter", "PyIcebergWriter",
    "TableWriter", "apply_watermark", "default_writer", "export_entity",
    "load_state", "map_record", "plan_export", "save_state",
]
