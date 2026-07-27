# Data Source Health Console (`/data-health`)

**Primary users:** Data stewards, platform administrators.
**Purpose:** operational trust surface — pipeline status, dataset freshness, failures with triage, review queues, and source contract compliance. This page powers the freshness chip in the topbar; its state propagates confidence throughout the app.

---

## Page Header

- Breadcrumb "Platform · Data operations". Title **"Data Source Health"**. Sub-caption: "47 registered sources · 41 healthy · 4 stale · 2 failing · Last full sync 02:00 WAT".
- Right actions: time-range segmented control (24h / 7d / 30d), ghost "Pipeline runs", primary "Register source" (steward/admin only).
- **Animation:** header fades 200ms; actions stagger 0.04s.

## Section 1 — Health overview strip (5 stat cards)

Compact stat cards (span ~2.4 cols): **Sources healthy** "41" (success), **Stale** "4" (warning), **Failing** "2" (danger), **Avg freshness** "3.2 days", **Contract compliance** "93.6%". Each with 7-day sparkline and StatusDot+label legend under the strip. Failing card pulses its dot (1.8s) until acknowledged.
- **Animation:** cards stagger 0.05s rise 12px; sparklines draw 500ms; counts tick up 600ms.

## Section 2 — Pipeline status board (7 cols) + Review queue (5 cols)

**Left: Pipelines table (DataTable)**
- Columns: Pipeline (name + connector icon: "NBS Labour Force Survey — API sync"), Source owner, Last run (mono relative "2h ago"), Schedule ("daily 02:00"), Duration, Status (StatusDot + label: Succeeded / Running / Failed / Stale), Freshness SLA bar (horizontal meter: green segment = within SLA, amber = approaching, red = breached — with text label), Actions (View runs / Pause / Re-run).
- Failed rows: danger left border + expandable inline error panel — error message (mono block), failed step in the DAG mini-view (Ingest → Parse → Transform → Materialize → Index; failed node highlighted), "Open logs", "Create triage task" (assigns to steward).
- **Animation:** rows stagger 0.03s (dense table — faster); status transitions crossfade 200ms; error panel expands 240ms height; DAG mini-view nodes highlight sequentially 0.08s stagger to the failure point.

**Right: Review queue panel**
- Tabs: **Extraction QA** (document OCR/clause reviews — 6 pending), **Contract approvals** (new/changed source contracts — 2 pending), **Issue triage** (data quality issues — 9 open).
- Queue rows: title ("Validate extraction: Education Regulations 2023, Schedule 2"), type chip, age ("3d"), assignee initials, severity icon+label. Click opens the review in context (links into Legislation Workbench review tab or contract modal).
- Empty queue state: `/empty-evidence.svg` + "Queue clear — nothing awaiting review."
- **Animation:** tab crossfade 180ms; rows stagger 0.05s; completing a review collapses the row out (240ms) and the count badge decrements with a 160ms scale pop.

## Section 3 — Source registry & contract compliance

- Searchable registry table: Source ("NBS Labour Force Survey", "State School Census 2024", "Corporate Affairs Commission registry extract", "OpenStreetMap / GRID3 boundaries"), domain (Labor / Education / Business / Geospatial), classification (Public / Official / Restricted chip), contract version, schema conformance %, freshness, owner, status.
- Row expand → **contract detail panel**: expected schema fields vs observed (matched = success check, drifted = amber "type drift: enrollment_count int→float", missing = danger), delivery SLA, last validation run, "Approve contract change" (when a drift is proposed — steward sign-off with comment, records audit event).
- **Animation:** expand 240ms; field-check rows stagger 0.03s; drifted fields highlight with a 300ms amber sweep on first reveal.

## Section 4 — Freshness heatmap (full width)

- Grid heatmap: rows = sources (top 20), columns = days (last 30), cell intensity = ingestion success/freshness (teal ramp for on-time, amber cells for late, red for missed, hatched pattern overlay as non-color encoding). Hover tooltip: "NBS LFS · 08 Jan · sync succeeded · 1,204 rows".
- **Animation:** cells fade in row-by-row 0.02s stagger on mount (total ~500ms); tooltip 120ms.

## Alerts & notifications

- Danger banner at top when any SLA breach: "2 sources breached freshness SLA — NBS LFS (3d overdue), CAC registry (1d overdue)" with "View" anchors. Acknowledge button (steward) stamps actor+timestamp (audit).

## Responsive

- ≥1280px: as above. 768–1279px: overview strip 2×3; board and queue stack; heatmap horizontal-scroll. <768px: tables become record cards with status chips; heatmap becomes a list of "last 7 days" status rows.

## Interactions checklist

All statuses icon + text + (heatmap) pattern. Re-run actions use idempotency keys and confirm modals. Every triage/approval action records an audit event with actor_id. Keyboard: standard table navigation; R re-run, T create triage task on focused row. Low-bandwidth: sparklines/heatmap replaced by text summaries via "View as table" default-on toggle.

## Assets

- `/empty-evidence.svg` (empty review queues). All visualizations data-rendered.
