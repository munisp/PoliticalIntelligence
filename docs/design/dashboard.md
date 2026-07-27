# Governor Executive Dashboard (`/dashboard`)

**Primary users:** Governor, Chief of Staff (read-only approved outputs; limited scenario initiation).
**Purpose:** one-page executive picture of the jurisdiction — job targets vs trajectory, sector highlights, top risks, scenario summaries — with memo/export actions. Everything is summary-first with drill-down via EvidenceDrawer and links into the specialist screens.

---

## Page Header

- Breadcrumb: "Kaduna State · Executive view". Title (Display): **"Executive Dashboard"**. Sub-caption: "Data as of 12 Jan 2025 · All figures evidence-traced" + freshness chip.
- Right actions: **ExportMenu** ("Export memo · DOCX", "Export brief · PDF", "Presentation · PPTX", "Print"), ghost button "Ask Copilot about this page" (opens copilot with page context preloaded), primary button "New scenario" (→ Simulation Studio, executive-limited template picker).
- **Animation:** header block fades in 200ms; action buttons stagger 0.04s rise 8px.

## Section 1 — Executive KPI row (4 ExecutiveStatCards)

Cards (span 3 cols each):
1. **Jobs supported YTD** — Metric XL "41,280", delta "+6,140 vs Q3", teal sparkline (12 months), ConfidenceChip "High · 0.86", evidence link.
2. **2027 target trajectory** — "16.5%" of 250,000 target, radial progress ring (teal track on inset), sub-caption "On pace: 2 of 5 scenarios".
3. **Youth unemployment (15–34)** — "28.4%", delta "−1.8 pts YoY" (downward = good, shown with down-arrow + success color + text "improving"), ConfidenceChip "Medium · 0.71" + caption "LFS proxy + imputation flag".
4. **Open approvals** — "3" items awaiting executive sign-off (2 briefs, 1 legal review); clicking filters to Approval queue popover; gold accent.
- **Animation:** cards stagger 0.06s rise 14px on mount; metrics count up 800ms; sparklines draw 600ms.

## Section 2 — Job target tracker (7 cols) + Top risks (5 cols)

**Left: "Path to 250,000 jobs by 2027"** (`bg-surface` panel):
- Horizontal milestone timeline 2024→2027 with cumulative jobs line; three scenario overlays (Conservative / Base / Accelerated) as dashed projections with 80% uncertainty band on Base; today-marker vertical gold line.
- Toggle chips above chart: scenario visibility; hover crosshair shows mono readouts per scenario.
- Footer row: "Last simulation run: 09 Jan 2025 · Twin v3.2 · Seed 42" (mono small) + link "Open in Simulation Studio →".
- **Animation:** chart draws in 700ms on mount; band fades after line (150ms offset); scenario toggles transition 400ms (no re-mount).

**Right: "Top risks"** panel:
- Ordered list of 4 risk rows: severity icon + label (High/Moderate), title ("School feeding funding gap — ₦2.1B unfunded", "Procurement delays in 6 LGAs", "Teacher attrition in rural wards", "SME credit uptake below forecast"), each with mono small meta "Source: Risk register · Updated 10 Jan", chevron expands inline detail + "mitigation" line + evidence link.
- Row severity shown as icon + text + left border tint (never color alone).
- **Animation:** rows stagger 0.07s rise 10px; expand/collapse animates height 240ms.

## Section 3 — Sector highlights (3 tabs)

- Tab group (Education / SME Formation / Public Procurement — the pilot sectors; "All sectors" option).
- Each tab shows 3 mini-cards in a row: sector KPI ("Primary enrollment 78.2% · +2.1 pts"), top opportunity ("Zaria agro-processing cluster · Score 0.86" + ConfidenceChip), and mini choropleth thumbnail of Kaduna with sector-relevant LGA highlight (click → Opportunity Explorer filtered).
- **Animation:** tab switch crossfades content 200ms with 8px rise; underline indicator slides 160ms (layout animation).

## Section 4 — Scenario summaries (compare strip)

- Horizontal scroll strip (snap) of 3–4 scenario cards: name ("Teacher recruitment +5,000", "Procurement SME set-aside 30%", "Agro-processing SEZ"), engine tag (mono chip: "Microsimulation", "System dynamics"), headline outcome metric ("+18,400 jobs by 2027 · 80% CI [14,200 – 22,900]"), ApprovalBadge ("Signed off" gold / "In review"), and a "View run →" link.
- **Animation:** cards stagger 0.06s; strip scroll has edge fade masks; hover raises card -3px (160ms).

## Section 5 — Recent decisions & audit tail (7 cols) + Approvals (5 cols)

**Left: "Recent platform activity"** — compact audit feed (8 rows): mono timestamp, actor initials chip, action text ("A. Bello signed off brief: Q1 SME credit facility", "Simulation run #1842 completed", "Dataset 'NBS LFS 2024Q4' refreshed"). Filter dropdown (All / Approvals / Runs / Data). Footer: "View full audit log →" (admin role only).
- **Animation:** new items insert with 12px slide + fade (aria-live polite).

**Right: "Awaiting your sign-off"** — stack of ApprovalHandoffCards (max 3 + "view all"): item title, type chip (Brief / Legal review / Scenario), submitted-by + date, one-line summary, Approve / Return buttons (Return requires comment — inline textarea expands). Approving triggers a gold seal stamp micro-animation (seal icon scales 0.8→1.15→1 with 240ms spring, brief shimmer) and the card collapses out.
- **Animation:** cards stagger 0.07s; approve transition 320ms total.

## Empty / degraded states

- Stale data (> 30 days): KPI cards keep last values but show amber "Stale" chip + banner "Figures older than 30 days — see Data Source Health".
- Low-bandwidth: charts replaced by "View as table" automatically if MapLibre/chart bundle fails; a banner notes the degraded mode.

## Responsive

- ≥1280px: as above. 768–1279px: KPI row 2×2; left/right panels stack full-width. <768px: single column; KPI cards full width; scenario strip becomes vertical list; ExportMenu collapses to bottom-sheet.

## Interactions checklist

Every metric/evidence link opens EvidenceDrawer (right, 480px) listing sources with issuer/date/relevance + lineage mini-graph. All charts have keyboard-accessible data table toggle. Page prints cleanly: KPI grid → 2×2, charts rasterized, citation appendix appended.

## Assets

None image-based — charts/map rendered from data. Uses shared components: ExecutiveStatCard, ConfidenceChip, ApprovalBadge, ApprovalHandoffCard, EvidenceDrawer, ExportMenu, UncertaintyBandChart.
