"""DM-4 lakehouse export CLI.

  python -m app.lakehouse export --entity sector_metrics [--full] \
      [--source-jsonl FILE] [--dry-run]

Rows come from the operational MySQL store by default (DATABASE_URL /
MYSQL_* env; uses PyMySQL when installed), or from a canonical JSONL file
(--source-jsonl) — the same JSONL shape the loader accepts (docs/LOADER.md),
which keeps the CLI fully exercisable in dev/CI without a database.

Watermark state persists per entity so repeated runs are incremental.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

from app.lakehouse.exporter import export_entity
from app.lakehouse.schema import TABLES
from app.logging_setup import get_logger

log = get_logger("lakehouse.cli")


def rows_from_jsonl(path: Path) -> list[dict[str, Any]]:
    rows = []
    for line in path.read_text().splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return rows


def rows_from_mysql(entity: str) -> list[dict[str, Any]]:
    """Select canonical rows for the entity from MySQL (PyMySQL extra)."""
    try:
        import pymysql
    except ImportError as exc:
        raise SystemExit(
            "pymysql not installed — use --source-jsonl or pip install pymysql"
        ) from exc
    conn = pymysql.connect(
        host=os.getenv("MYSQL_HOST", "localhost"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "policytwin"),
        password=os.getenv("MYSQL_PASSWORD", "policytwin"),
        database=os.getenv("MYSQL_DATABASE", "policytwin"),
        cursorclass=pymysql.cursors.DictCursor,
    )
    table = TABLES[entity].table
    with conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM `{table}`")
        return list(cur.fetchall())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.lakehouse")
    sub = parser.add_subparsers(dest="command", required=True)
    exp = sub.add_parser("export", help="export canonical entities to the lakehouse")
    exp.add_argument("--entity", required=True, choices=sorted(TABLES))
    exp.add_argument("--full", action="store_true",
                     help="ignore the watermark and re-export everything")
    exp.add_argument("--source-jsonl", type=Path,
                     help="canonical JSONL input instead of MySQL")
    exp.add_argument("--dry-run", action="store_true",
                     help="plan + map only; do not write or persist state")
    args = parser.parse_args(argv)

    if args.command == "export":
        rows = (
            rows_from_jsonl(args.source_jsonl)
            if args.source_jsonl
            else rows_from_mysql(args.entity)
        )
        if args.dry_run:
            from app.lakehouse.exporter import load_state, plan_export

            plan = plan_export(args.entity, load_state(), full=args.full)
            print(json.dumps({
                "entity": plan.entity,
                "table": f"{plan.namespace}.{plan.table}",
                "partition_by": list(plan.partition_by),
                "since": plan.since,
                "full": plan.full,
                "candidate_rows": len(rows),
            }, indent=2))
            return 0
        result = export_entity(args.entity, rows, full=args.full)
        print(json.dumps({
            "entity": result.entity,
            "rows_exported": result.rows,
            "since": result.plan.since,
        }, indent=2))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
