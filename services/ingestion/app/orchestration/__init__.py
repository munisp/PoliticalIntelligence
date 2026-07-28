"""ING-8: orchestration layer (Dagster + Airbyte manifests).

dagster_defs is import-guarded: dagster is an optional extra, so the module
exposes pure planning functions (cron mapping, schedule specs) that work
without dagster installed, plus build_definitions() which needs it.
"""
