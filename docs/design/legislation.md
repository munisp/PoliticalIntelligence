# Policy & Legislation Workbench (`/legislation`)

**Primary users:** Legal drafters/analysts, policy teams.
**Purpose:** clause-aware navigation of the legal corpus, dependency reasoning between laws/regulations/policies, citation tracing for recommendations, human review workflow, and draft export. Embodies the principle: **legal outputs are never auto-published — human sign-off is built into the UI.**

---

## Page Header

- Breadcrumb "Kaduna State · Legal corpus". Title **"Policy & Legislation Workbench"**. Sub-caption: "1,284 instruments · 9,612 clauses indexed · Graph v5 · OCR QA pass rate 97.2%".
- Right actions: search-in-corpus field (⌘K pre-scoped), ghost "Citation trace", dropdown "New draft" (Amendment memo / Regulation impact note / Model clause), primary "Submit for review" (enabled when a working draft is open).
- **Animation:** header fades 200ms; actions stagger 0.04s.

## Three-pane layout (the workbench signature)

Desktop: **Pane A — Instrument navigator (280px)** · **Pane B — Clause reader (fluid)** · **Pane C — Context panel (360px, tabbed)**. Panes A and C are collapsible (rail icons remain); collapse animates width 240ms with content reflow (no re-mount).

### Pane A — Instrument navigator

- Tree: corpus grouped by type (Laws of Kaduna State / Federal Acts / Regulations / Policy memos / Executive orders) → instrument → part → section. Search filters tree live (160ms debounce); match counts in mono.
- Each instrument row: title ("Kaduna State Public Procurement Law 2016"), clause count, StatusDot + label for indexing health ("Indexed", "OCR review pending", "Metadata incomplete"), and ApprovalBadge where a review task is attached.
- Sample instruments: Kaduna State Public Procurement Law 2016; Kaduna State SME Development Agency Law 2021; Universal Basic Education Act 2004 (Federal); Kaduna State Education Quality Assurance Regulations 2023; Public Procurement Act 2007 (Federal).
- **Animation:** tree expand/collapse rotates chevron 180° + height 200ms; search highlight sweeps matched text (160ms).

### Pane B — Clause reader

- Document rendering in **IBM Plex Serif** (document register) on `bg-surface`: instrument title page header (title, instrument number "KDBS/PROC/2016/004", commencement date, issuer), then clauses as numbered blocks ("Section 34(2) — Thresholds for open competitive bidding…").
- Active clause (clicked or keyboard-focused) gets a 3px teal left bar + `bg-elevated`; related clauses referenced in the graph get a subtle periwinkle underline.
- Inline affordances on active clause: hover toolbar (Cite / Trace dependencies / Add to draft / Flag for review / Ask Copilot).
- Citation preview: hovering a cross-reference ("as defined in Section 12(1)") shows a 300px popover card with the referenced clause text (220ms fade, 8px rise).
- Version selector in header: "Consolidated 2023 · Original 2016" — switching crossfades text and shows a diff summary chip ("3 sections amended").
- **Animation:** clause focus bar slides vertically to the active clause (spring 240ms); cross-reference popovers 220ms; version switch 300ms crossfade.

### Pane C — Context panel (tabs)

- **Dependencies** — legal dependency graph for the active clause: vertical tree (upstream: what this clause depends on; downstream: what depends on it) rendered as connected node rows with mono edge labels ("amends", "supersedes", "defines term", "sets threshold"). Clicking a node loads that clause in Pane B (gold trail breadcrumb records the path — "34(2) ← 12(1) ← PPA 2007 s.4"). Path depth toggle 1/2/3 hops.
- **Citations** — where this clause is cited across the platform: opportunities, briefs, simulation assumptions (each entry links out; e.g., "Cited in: Zaria agro-processing cluster — Legal dependencies").
- **Review** — the human review workflow: review task card (task "Validate OCR extraction of Schedule 2 thresholds", assigned legal analyst, due date), extraction QA panel (OCR text vs source scan thumbnail, character-confidence heatmap toggle), Approve extraction / Request re-parse buttons, comment thread.
- **Drafts** — working draft outline: sections assembled from clauses, reorderable (drag, 200ms layout animation), each section shows its citation chain count; footer "Export draft — DOCX / PDF".
- **Animation:** tab switch crossfade 180ms; dependency nodes stagger 0.05s rise 8px on load; graph path traces animate the connecting line draw 400ms.

## Citation trace modal (from header)

- Full-screen modal (`bg-base` 95% backdrop): horizontal provenance chain for a chosen output — "Recommendation → supporting clauses → source instruments → ingestion job → original document scan". Each node is a card; edges labeled with transform ("parsed by LexNLP v1.3", "embedded qwen3-emb", "retrieved rank #2, score 0.91").
- **Animation:** modal fades+scales 0.98→1 (240ms); chain draws left→right, nodes stagger 0.06s.

## Review handoff

- "Submit for review" opens ApprovalHandoffCard modal: summary of the draft/extraction, reviewer dropdown (legal panel members), required comment, submit. State changes broadcast to the recipient's approval queue. Approved legal extractions flip StatusDot to "Verified" + gold check.

## Empty / degraded states

- Unparsed document: reader shows OCR raw text with amber banner "Extraction pending — QA review required" and every clause chip shows "Unverified".
- Graph offline (Neo4j unavailable): Dependencies tab shows cached snapshot with caption "Snapshot from 10 Jan · live graph unavailable" (offline-first behavior).

## Responsive

- ≥1440px: three panes. 1024–1439px: Pane C becomes an overlay drawer (right, 420px) triggered by clause toolbar. <1024px: single column — navigator collapses into top sheet; context panel becomes bottom sheet tabs; reader keeps serif document styling.

## Interactions checklist

Full keyboard model: J/K move between clauses, Enter focus, T trace dependencies, C cite, D add to draft. All statuses icon + text. Draft export records audit event and embeds the citation list as an annex. Print renders the instrument with margin citations (legal-document style).

## Assets

None image-based; document scan thumbnails come from the document store (data). Uses EvidenceDrawer patterns for source scans; EmptyState art `/empty-evidence.svg` for empty review queue ("Review queue clear — all extractions verified").
