# Simulation Studio (`/simulation`)

**Primary users:** Simulation specialists, analysts (executives have a limited template mode).
**Purpose:** build scenarios, edit assumptions, run asynchronous simulations across six engines, compare runs with uncertainty bands, and access persisted artifacts. Runs are seeded and auditable — every chart shows its engine, version, and seed.

---

## Page Header

- Breadcrumb "Kaduna State · Scenario engine". Title **"Simulation Studio"**. Sub-caption: "Twin state v3.2 · Last calibration 09 Jan 2025 · Engines: 6 available".
- Right actions: ghost "Run history", ghost "Assumptions registry", primary **"New scenario"**.
- **Animation:** header fades 200ms; actions stagger 0.04s.

## Layout: tabbed studio (Builder / Runs / Compare / Artifacts)

Tab bar under header; tab switch crossfades content 200ms with 8px rise. URL-synced deep links (`/simulation?tab=compare`).

### Tab 1 — Scenario Builder (default)

Two columns: **configuration form (7 cols)** + **live summary card (5 cols, sticky)**.

**Form (accordion sections, expand 240ms height animation):**
1. **Basics** — name ("Teacher recruitment surge FY25"), description, horizon (3/5/10-yr segmented), geography scope (tree-select LGAs/wards).
2. **Engine selection** — radio card grid (2×3): Forecast (PyMC-style), Causal inference (DoWhy-style), Microsimulation (OpenFisca-style rules), Agent-based (Mesa-style), System dynamics (PySD-style), Optimization (OR-Tools-style). Each card: mono engine tag, one-line description, typical runtime caption ("~6 min"), recommended-for hint. Selected card: teal border + left bar.
3. **Intervention levers** — parameter rows generated per engine (e.g., microsim: "Additional teachers recruited" number input 5,000; "Salary adjustment %" slider; "Procurement SME set-aside %" slider 0–50). Each lever shows its baseline from the twin state (mono small) and a reset affordance.
4. **Assumptions** — registry-driven: assumption rows (name, current value, unit, source, who-set, last-validated) with inline edit; edits mark the row "Modified from registry" (amber chip) until confirmed. Link to full Assumptions registry modal.
5. **Execution** — seed (default 42, mono), model version pin, priority, notification toggle ("Notify on completion").

**Live summary card:** scenario name, engine, lever deltas vs baseline (list of "Teachers +5,000 vs baseline 0"), estimated runtime, estimated cost (compute), and a mini baseline chart for context. Primary button **"Queue run"** — submits async job; button morphs to progress state ("Queued → Running") and the job appears in topbar Jobs indicator with live polling; on completion, toast + Runs tab badge increments (aria-live).
- **Animation:** accordion sections stagger 0.05s on first mount; engine cards lift -3px on hover (160ms); lever sliders animate value fill 120ms; queue button state transition 240ms.

### Tab 2 — Runs (async run monitor)

- DataTable of runs: Run ID (mono, "#1842"), scenario name, engine chip, status (StatusDot + label: Queued / Running / Succeeded / Failed / Cancelled), submitted by/at, duration, seed, actions (View, Compare, Cancel, Re-run).
- Running rows show an inline progress bar (striped shimmer) + live step caption ("Calibrating ward-level priors… 62%") updated by polling.
- Row expand: run metadata (inputs JSON viewer, model versions, request/correlation IDs, artifact links) + outcome summary.
- Filter chips: status, engine, mine/all, date range.
- **Animation:** rows stagger 0.04s; progress bar animates smoothly between poll updates (400ms ease); status changes crossfade icon+label 200ms; completed rows flash a 600ms teal row-highlight then settle.

### Tab 3 — Compare runs

- Run picker (multi-select, max 4) → stacked **UncertaintyBandChart** panels, one per outcome metric (Jobs created, Youth unemployment, Budget outlay, School enrollment): all selected runs overlaid with distinct series colors + each run's 80% credible band; legend doubles as visibility toggles.
- Below: divergence summary cards — "Largest divergence at Month 18: Run #1839 vs #1841 — 6,200 jobs (band overlap 34%)" with a "Why?" button that opens the causal-diff explanation panel (plain-language + parameter diff table).
- Assumption diff table: rows = assumptions, columns = runs, cells show values with deltas highlighted.
- **Animation:** charts draw 600ms staggered 0.1s; band fills fade in 150ms after lines; toggling a series transitions 400ms opacity (never re-mount); divergence cards stagger 0.06s.

### Tab 4 — Artifacts

- Grid of artifact cards per selected run: forecast posterior samples (parquet), causal estimates (CSV), scenario report (PDF), input snapshot (JSON), engine logs (txt). Card: type icon, filename (mono small), size, checksum prefix, "Download" + "Copy artifact URI".
- Batch bar: "Download all (.zip)".
- **Animation:** cards stagger 0.05s rise 10px; download buttons show inline progress ring.

## Executive limited mode

- For executive role: Builder collapses to **template picker** (pre-approved scenario templates with fixed engine + locked assumptions, only 2–3 exposed levers) — large template cards ("Recruit teachers", "SME credit facility", "Procurement set-aside") with preview outcome ranges. Everything else read-only.

## Empty / degraded states

- No runs: EmptyState "No simulation runs yet — build your first scenario." Simulation service offline: banner "Scenario engine unavailable — queued runs will resume automatically" + Queue stays enabled (jobs persist).

## Responsive

- ≥1280px: as above. 768–1279px: builder form full-width, summary card moves above form; compare charts stack. <768px: tabs become segmented control; charts horizontal-scroll cards; run table becomes record cards with status chips.

## Interactions checklist

Run status uses aria-live polite announcements. All charts have data-table toggle + print support (bands preserved in print via pattern fill fallback). Re-run carries the same idempotency scope; audit event records actor, seed, model versions. Keyboard: ⌘Enter queues a run from Builder.

## Assets

None image-based — all charts rendered from run data. Uses UncertaintyBandChart, StatusDot, EmptyState (`/empty-evidence.svg` not needed here; use mono flask icon), ExportMenu (scenario report PDF export records audit event).
