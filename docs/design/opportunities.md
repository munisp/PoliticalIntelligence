# Sector Opportunity Explorer (`/opportunities`)

**Primary users:** Policy analysts, ministry specialists.
**Purpose:** ranked, scored job-creation opportunities by sector and geography — filter, map, inspect evidence, compare candidates, and trigger async generation of new opportunity analyses.

---

## Page Header

- Breadcrumb "Kaduna State · Opportunity Explorer". Title **"Sector Opportunity Explorer"**. Sub-caption: "24 ranked opportunities · Scoring model v2.4 · Generated 11 Jan 2025".
- Right actions: saved-views dropdown ("My views: SME pipeline, Education FY25"), ghost "Compare (0/3)" (activates compare tray), primary **"Generate opportunities"** → opens generation modal (sector, geography, horizon, note; submits async job with idempotency key; job appears in topbar Jobs indicator; toast + list refresh on completion).
- **Animation:** header fades 200ms; primary button has 120ms press scale.

## FilterBar (sticky under header)

- Sector multi-select chips (Education, SME Formation, Public Procurement, Agro-processing, Digital Services), geography tree-select (State → LGA → ward), horizon segmented control (1-yr / 3-yr / 5-yr), confidence floor slider (0–100%, default 50%), sort dropdown (Score / Jobs impact / Cost-efficiency / Freshness), result count "24 opportunities", reset.
- **Animation:** filter changes trigger FLIP layout re-sort (200ms) of the ranking list — rows visibly glide to new positions; chip add/remove animates 160ms.

## Main layout: ranking list (7 cols) + map panel (5 cols, sticky)

**Left: Ranked opportunities list**
- Each row-card (`bg-surface`, 96px): rank numeral (mono, text-muted), title ("Zaria agro-processing cluster — ginger & maize value chain"), sector chip, geography path (mono small "Kaduna › Zaria"), three inline metrics (Score 0.86 · Est. jobs 12,400 · Cost/job ₦310k), ConfidenceChip, freshness caption ("Evidence: 9 sources · newest 04 Jan"), chevron.
- Expandable: expanding a row reveals an inline detail band — recommendation blueprint summary (Rationale, Assumptions count, Budget range ₦3.8B–₦5.2B, Timeline 18–30 mo, Implementation actors, Risk count 4, KPI list) + actions: "Open evidence" (EvidenceDrawer), "Simulate →" (pre-fills Simulation Studio), "Add to compare".
- Skeleton rows during load (exact same 96px height — no shift).
- **Animation:** rows stagger 0.05s rise 12px on first mount; expand animates height 260ms with inner content fading 100ms later; hover elevates border to `border-strong` (160ms).

**Right: MapPanel (sticky, top 88px)**
- Kaduna LGA choropleth colored by opportunity score for active filters; layer toggles: Opportunity score / Unemployment / School density / Travel-time catchments (45/90-min isochrones from selected site); ward-level drill on double-click; hovered LGA shows tooltip card (name, score, top opportunity, unemployment).
- Selecting a list row highlights its LGA with a 2px teal stroke + soft pulse (2s). Selecting on map filters list (chip appears in FilterBar).
- Legend bottom-left (5-step teal ramp, mono values); bottom-right "View data as table" toggle (low-bandwidth fallback swaps map for a sortable LGA table).
- **Animation:** layer switches crossfade choropleth fills 400ms; isochrones draw outward 500ms; tooltip fades 120ms following cursor with 8px offset.

## Compare tray & compare view

- "Add to compare" (max 3) pins mini-cards into a bottom tray (64px, slides up 240ms); tray has "Compare now →".
- Compare view replaces main area: 3-column side-by-side spec sheet — metrics table (Score, Jobs, Budget range, Timeline, Cost/job, Confidence, Risk count) with best-in-row highlighted teal + delta captions; radar mini-chart overlaying the three; evidence overlap note ("2 shared sources"); actions per column: Simulate, Open evidence, Export comparison PDF.
- **Animation:** columns stagger 0.08s rise 16px; radar draws 500ms; row highlight sweeps 200ms.

## EvidenceDrawer (shared, opened from rows)

- Tabs: **Sources** (9 cited documents: title, issuer — e.g., "NBS Labour Force Survey Q3 2024", date, relevance bar), **Blueprint** (full typed recommendation JSON rendered as structured sections), **Lineage** (mini graph: datasets → features → scoring model v2.4 → this opportunity), **Assumptions** (registry list with values + who set them).
- Footer: mono small "request_id 9f2c…a41 · model qwen3-32b · generated 11 Jan 2025".
- **Animation:** drawer slides 280ms; tab content crossfades 180ms; relevance bars draw 400ms staggered 0.04s.

## Empty / low-data states

- No results after filtering: EmptyState (`/empty-evidence.svg`) "No opportunities match these filters — lower the confidence floor or generate a new analysis."
- Low-data jurisdiction: rows render with "Low confidence — proxy features in use" chip and an imputation-flag tooltip (per BR-8); confidence floor slider warns when set above available data.

## Responsive

- ≥1280px: list + sticky map. 768–1279px: map collapses into a tab above the list ("List | Map"). <768px: list rows become stacked record cards; map tab full-screen with layer bottom-sheet; compare becomes swipeable columns.

## Interactions checklist

Keyboard: ↑/↓ move row focus, Enter expands, C adds to compare, E opens evidence. All metrics keyboard-readable via table toggle. Export comparison records an audit event. Generation modal explains async flow ("Typical run: 4–8 minutes; you'll be notified").

## Assets

- `/empty-evidence.svg` (empty state). Map and charts are data-rendered; no image assets.
