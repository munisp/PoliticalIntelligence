# Executive Brief Generator (`/briefs`)

**Primary users:** Chief of staff, analysts; executives consume and sign off.
**Purpose:** structured, evidence-grounded executive briefs generated asynchronously from platform data — templates, approval handoff, and presentation/print outputs that preserve citation traceability.

---

## Page Header

- Breadcrumb "Kaduna State · Executive briefs". Title **"Executive Brief Generator"**. Sub-caption: "12 briefs · 3 awaiting approval · Templates v1.6".
- Right actions: ghost "Template library", primary **"New brief"**.
- **Animation:** header fades 200ms; actions stagger 0.04s.

## Layout: brief list (left rail 340px) + working area (fluid)

### Left rail — Brief list

- Search + status filter chips (All / Draft / In review / Approved / Signed off / Returned).
- Brief rows (72px): title ("Q1 2025 SME credit facility — decision brief"), type chip (Decision / Situation / Progress / Options), ApprovalBadge, date, author initials. Active row: teal left bar + `bg-elevated`.
- **Animation:** rows stagger 0.05s rise 10px on mount; filter changes use FLIP re-sort 200ms.

### Working area — three states

**State 1 — Brief composer (new/edit):**
- Template picker row: 4 template cards — **Decision brief** (recommendation + options + ask), **Situation brief** (status + risks), **Progress brief** (KPI vs target), **Options memo** (2–4 options compared). Each card shows its section skeleton preview.
- Structured form driven by the template schema: sections as collapsible blocks (eyebrow label + rich text area with platform-entity insertion — toolbar buttons insert live references: [Metric], [Opportunity], [Simulation run], [Clause citation]. Inserted entities render as periwinkle chips that stay linked and auto-update values on generation).
- "Evidence pack" side panel (right, collapsible 320px): auto-attached sources for every inserted entity (title, issuer, date, relevance); analyst can detach (requires reason) or add sources via corpus search.
- Generation: primary button **"Generate brief"** → async job (LLM routing tier shown: "qwen3-32b · standard"), button morphs to progress with step captions ("Assembling evidence… → Drafting sections… → Validating citations…"); completion toast; output state: Draft.
- **Animation:** template cards stagger 0.06s; section blocks expand 240ms; entity chips pop in with 160ms scale 0.9→1; generation progress steps crossfade 300ms each.

**State 2 — Brief preview (the document):**
- Document page on `bg-surface` rendered in **IBM Plex Serif** with formal government-memo layout: header block (coat-of-arms slot → logo-mark, "KADUNA STATE — OFFICE OF THE GOVERNOR", brief title, classification chip "OFFICIAL — INTERNAL", date, ref number mono), then serif body sections, superscript citation markers `[1][2]` that highlight on hover and scroll-sync to a right-side **citation rail** (numbered source cards).
- Margin rail: approval sidebar — ApprovalHandoffCard with current state, chain (Analyst → Chief of Staff → Governor), comment thread, Approve / Sign off (gold, executive only) / Return buttons. Signing off triggers the gold seal stamp animation (spring 0.8→1.15→1, 300ms shimmer) and flips the badge to "Signed off".
- Output bar (top of preview): ExportMenu — Memo DOCX, Brief PDF, **Presentation (PPTX)** (auto-generates 6-slide deck: title, situation, options, recommendation, evidence, decision ask), Print. Each item shows last-export caption.
- **Animation:** preview fades in 300ms on load; citation hover crosshighlights both marker and rail card (160ms); section scroll spy moves a teal indicator in the citation rail.

**State 3 — Presentation preview (toggle in output bar):**
- Slide-strip viewer: 6 slide thumbnails (16:9, `bg-elevated`, title + bullet skeletons + one chart each), click to view large; reorder via drag (200ms layout animation); "Export PPTX" primary.
- **Animation:** thumbnails stagger 0.05s; active slide scales 1.02 with teal border.

## Approval handoff flow (cross-role)

- Submit for review → recipient's topbar approval badge increments + toast. Returned briefs show amber "Returned with comments" banner with the comment inline and a Resolve button (re-submits to same reviewer). Full state history in a collapsible timeline under the margin rail (mono timestamps, actor, action).

## Empty / degraded states

- No briefs: EmptyState "No briefs yet — generate your first decision brief from a template." AI service offline (deterministic fallback): banner "LLM routing unavailable — briefs generated from structured template assembly only (no synthesized prose)" and generated text is marked "Template-assembled · not AI-synthesized".

## Responsive

- ≥1280px: rail + working area. 768–1279px: rail collapses to a dropdown selector above the working area; citation rail becomes bottom sheet. <768px: single column; preview citation markers open popovers; presentation viewer is a swipe carousel.

## Interactions checklist

Citations survive every export: DOCX/PDF annex the numbered source list with request_id; PPTX adds an "Evidence" final slide. Print: formal A4 memo layout, margin citations, footer with approval state + request_id on each page. Keyboard: ⌘P print, ⌘E export menu, ⌘Enter submit for review. All state changes emit audit events.

## Assets

- `/logo-mark.svg` in the memo header block. Everything else typographic/data-rendered. No other image assets.
