"""DM-4 (ADR-005): canonical-entity export pipeline to the Iceberg lakehouse.

Flow:
  operational MySQL rows -> canonical record mapping -> table writer
  (PyIceberg when installed; the writer is a small protocol so tests and
  dry-run planning work WITHOUT pyiceberg).

Incremental export: per-entity high-water marks (max(updated_at)) persisted
in a state file; each run selects only rows with updated_at > watermark.
Partition layout comes from lakehouse.schema.TABLES.

Catalog resolution (env):
  LAKEHOUSE_WAREHOUSE   warehouse location (default s3://policy-twin/lakehouse;
                        use file:///path for a local warehouse dir)
  S3_ENDPOINT           MinIO/S3 endpoint (e.g. http://minio:9000)
  S3_ACCESS_KEY/S3_SECRET_KEY
  LAKEHOUSE_CATALOG     'sql' (default; sqlite catalog file for dev) | 'rest'
  LAKEHOUSE_STATE_FILE  watermark state (default <artifacts>/lakehouse-state.json)
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Protocol

from app.config import settings
from app.lakehouse.schema import NAMESPACE, TABLES, TableSchema
from app.logging_setup import get_logger

log = get_logger("lakehouse")


# ---------------------------------------------------------------------------
# Record mapping
# ---------------------------------------------------------------------------
def map_record(schema: TableSchema, row: dict[str, Any]) -> dict[str, Any]:
    """Project a canonical DB row onto the lakehouse table schema.

    Unknown/extra columns are dropped; missing columns become None (except
    required ones, which raise — a canonical row without its natural key or
    updated_at must never reach the lake)."""
    rec: dict[str, Any] = {}
    for col in schema.columns:
        v = row.get(col.name)
        if v is None and col.required:
            raise ValueError(
                f"{schema.entity}: required column '{col.name}' missing in row {row!r}"
            )
        if isinstance(v, datetime):
            v = v.astimezone(timezone.utc).isoformat()
        rec[col.name] = v
    return rec


# ---------------------------------------------------------------------------
# Incremental planning
# ---------------------------------------------------------------------------
@dataclass
class ExportPlan:
    entity: str
    table: str
    namespace: str
    partition_by: tuple[str, ...]
    watermark_column: str
    since: str | None  # ISO timestamp; None = full export
    full: bool


def plan_export(
    entity: str,
    state: dict[str, str],
    *,
    full: bool = False,
    now: float | None = None,
) -> ExportPlan:
    """Pure planning: given the persisted watermark state, decide the export
    window for one entity. `now` is injectable for deterministic tests."""
    if entity not in TABLES:
        raise KeyError(
            f"unknown entity '{entity}' — expected one of: {sorted(TABLES)}"
        )
    schema = TABLES[entity]
    since = None if full else state.get(entity)
    return ExportPlan(
        entity=entity,
        table=schema.table,
        namespace=NAMESPACE,
        partition_by=schema.partition_by,
        watermark_column=schema.updated_at_column,
        since=since,
        full=full or since is None,
    )


def apply_watermark(
    state: dict[str, str], plan: ExportPlan, rows: Iterable[dict[str, Any]]
) -> dict[str, str]:
    """Advance the watermark to max(updated_at) across exported rows."""
    new_state = dict(state)
    # floor = the greater of the plan window and any recorded watermark, so
    # watermarks never regress even if a stale plan is reused
    best = max(filter(None, [plan.since, state.get(plan.entity)]), default=None)
    for row in rows:
        v = row.get(plan.watermark_column)
        if v is None:
            continue
        s = v.isoformat() if isinstance(v, datetime) else str(v)
        if best is None or s > best:
            best = s
    if best:
        new_state[plan.entity] = best
    return new_state


# ---------------------------------------------------------------------------
# State persistence
# ---------------------------------------------------------------------------
def state_file() -> Path:
    return Path(
        os.getenv(
            "LAKEHOUSE_STATE_FILE",
            os.path.join(settings.artifacts_dir, "lakehouse-state.json"),
        )
    )


def load_state(path: Path | None = None) -> dict[str, str]:
    p = path or state_file()
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def save_state(state: dict[str, str], path: Path | None = None) -> None:
    p = path or state_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(state, indent=2, sort_keys=True))


# ---------------------------------------------------------------------------
# Table writers
# ---------------------------------------------------------------------------
class TableWriter(Protocol):
    """Minimal writer interface — PyIceberg-backed in production, fake in
    unit tests."""

    def write(self, namespace: str, table: str, schema: TableSchema,
              records: list[dict[str, Any]]) -> int:  # rows written
        ...


class PyIcebergWriter:
    """Iceberg writer via pyiceberg (optional extra — imported lazily).

    Catalog: 'sql' (sqlite file — dev/local) or 'rest' (e.g. Nessie/Tabular).
    Warehouse: s3:// (MinIO via S3_ENDPOINT) or file:// local dir."""

    def __init__(self) -> None:
        try:
            from pyiceberg.catalog import load_catalog  # noqa: F401
        except ImportError as exc:  # pragma: no cover - env dependent
            raise RuntimeError(
                "pyiceberg is not installed — pip install -r "
                "requirements-extras.txt (extra: pyiceberg)"
            ) from exc
        self._catalog = self._load_catalog()

    @staticmethod
    def _load_catalog():  # pragma: no cover - needs pyiceberg
        from pyiceberg.catalog import load_catalog

        warehouse = os.getenv("LAKEHOUSE_WAREHOUSE", "s3://policy-twin/lakehouse")
        kind = os.getenv("LAKEHOUSE_CATALOG", "sql")
        props: dict[str, Any] = {"warehouse": warehouse}
        if kind == "sql":
            db = os.getenv(
                "LAKEHOUSE_CATALOG_DB",
                os.path.join(settings.artifacts_dir, "lakehouse-catalog.db"),
            )
            Path(db).parent.mkdir(parents=True, exist_ok=True)
            props["uri"] = f"sqlite:///{db}"
        elif kind == "rest":
            props["uri"] = os.environ["LAKEHOUSE_REST_URI"]
        else:
            raise ValueError(f"unsupported LAKEHOUSE_CATALOG '{kind}'")
        if warehouse.startswith("s3://") and os.getenv("S3_ENDPOINT"):
            props.update(
                {
                    "s3.endpoint": os.environ["S3_ENDPOINT"],
                    "s3.access-key-id": os.getenv("S3_ACCESS_KEY", "minioadmin"),
                    "s3.secret-access-key": os.getenv(
                        "S3_SECRET_KEY", "minioadmin"
                    ),
                    "s3.path-style-access": "true",
                }
            )
        return load_catalog("lakehouse", **props)

    def write(self, namespace: str, table: str, schema: TableSchema,
              records: list[dict[str, Any]]) -> int:  # pragma: no cover
        import pyarrow as pa
        from pyiceberg.partitioning import PartitionField, PartitionSpec
        from pyiceberg.schema import Schema as IcebergSchema
        from pyiceberg.transforms import IdentityTransform
        from pyiceberg.types import (
            DoubleType, LongType, NestedField, StringType,
            TimestamptzType,
        )

        type_map = {
            "string": StringType(),
            "long": LongType(),
            "double": DoubleType(),
            "timestamp": TimestamptzType(),
            "boolean": StringType(),
        }
        fields = [
            NestedField(
                field_id=i + 1,
                name=c.name,
                field_type=type_map[c.iceberg_type],
                required=c.required,
            )
            for i, c in enumerate(schema.columns)
        ]
        iceberg_schema = IcebergSchema(*fields)
        spec_fields = [
            PartitionField(
                source_id=iceberg_schema.find_field(name).field_id,
                field_id=1000 + i,
                transform=IdentityTransform(),
                name=name,
            )
            for i, name in enumerate(schema.partition_by)
        ]
        spec = PartitionSpec(*spec_fields) if spec_fields else PartitionSpec()
        ident = (namespace, table)
        try:
            self._catalog.create_namespace_if_not_exists(namespace)
        except AttributeError:
            self._catalog.create_namespace(namespace)
        try:
            tbl = self._catalog.create_table(
                ident, schema=iceberg_schema, partition_spec=spec
            )
        except Exception:
            tbl = self._catalog.load_table(ident)
        arrow_schema = pa.schema(
            [(c.name, {"string": pa.string(), "long": pa.int64(),
                       "double": pa.float64(), "timestamp": pa.string(),
                       "boolean": pa.bool_()}[c.iceberg_type])
             for c in schema.columns]
        )
        tbl.append(pa.Table.from_pylist(records, schema=arrow_schema))
        return len(records)


@dataclass
class LocalJsonlWriter:
    """Warehouse-dir writer used when pyiceberg is absent (dev/CI): writes
    partitioned JSONL under <warehouse>/<namespace>/<table>/ so the export
    pipeline is still fully exercisable and inspectable."""

    root: Path
    written: list[tuple[str, str, int]] = field(default_factory=list)

    def write(self, namespace: str, table: str, schema: TableSchema,
              records: list[dict[str, Any]]) -> int:
        out = self.root / namespace / table
        out.mkdir(parents=True, exist_ok=True)
        part = out / f"part-{int(time.time() * 1000)}.jsonl"
        with part.open("w") as fh:
            for rec in records:
                fh.write(json.dumps(rec, default=str) + "\n")
        self.written.append((namespace, table, len(records)))
        return len(records)


def default_writer() -> TableWriter:
    """PyIceberg when installed, otherwise a local JSONL warehouse writer
    (explicitly logged — the dry-run/dev path)."""
    try:
        import pyiceberg  # noqa: F401

        return PyIcebergWriter()
    except ImportError:
        warehouse = os.getenv("LAKEHOUSE_WAREHOUSE", "file:///tmp/lakehouse")
        root = Path(warehouse.removeprefix("file://")) / "jsonl-preview"
        log.warning(
            "pyiceberg not installed — writing JSONL preview under %s "
            "(install requirements-extras.txt extra for real Iceberg)",
            root,
        )
        return LocalJsonlWriter(root=root)


# ---------------------------------------------------------------------------
# Export driver
# ---------------------------------------------------------------------------
@dataclass
class ExportResult:
    entity: str
    rows: int
    plan: ExportPlan


def export_entity(
    entity: str,
    rows: Iterable[dict[str, Any]],
    *,
    writer: TableWriter | None = None,
    full: bool = False,
    state: dict[str, str] | None = None,
    persist_state: bool = True,
    state_path: Path | None = None,
) -> ExportResult:
    """Export one entity: plan (incremental window), map records, write,
    advance the watermark. `rows` are canonical DB rows supplied by the
    caller (DB access stays in the CLI so the pipeline is testable)."""
    rows = list(rows)
    state = load_state(state_path) if state is None else dict(state)
    plan = plan_export(entity, state, full=full)
    schema = TABLES[entity]

    selected = []
    for row in rows:
        if plan.since is not None:
            v = row.get(plan.watermark_column)
            s = v.isoformat() if isinstance(v, datetime) else str(v) if v else None
            if s is None or s <= plan.since:
                continue
        selected.append(map_record(schema, row))

    writer = writer or default_writer()
    n = writer.write(plan.namespace, plan.table, schema, selected) if selected else 0
    new_state = apply_watermark(state, plan, rows)
    if persist_state:
        save_state(new_state, state_path)
    log.info(
        "exported %s: %d rows (since=%s full=%s)",
        entity, n, plan.since, plan.full,
    )
    return ExportResult(entity=entity, rows=n, plan=plan)
