# Global Design — Jurisdiction Economic Intelligence & Policy Twin Platform

**Working product name:** **Meridian Policy Twin** (brand line: *"Evidence before policy."*) — the deployable UI brand for the Jurisdiction Economic Intelligence & Policy Twin Platform. Reference deployment: **Federal Republic of Nigeria**, pilot state **Kaduna State** (federal → state → LGA → ward hierarchy; pilot sectors: education, SME formation, procurement-led job creation).

**Product type:** data-dense decision-support **application** (not a marketing site). Desktop-first, tablet-supported, installable PWA and Capacitor native-shell basis. Role-based experiences: Executive (governor/chief of staff), Policy analyst, Legal analyst, Simulation specialist, Data steward, Platform administrator.

---

## 1. Design Principles

1. **Evidence before generation** — every high-impact output visibly carries: confidence score, evidence provenance, and approval state. No output is shown without its trace.
2. **Progressive disclosure** — executive summary first; drill-down to evidence, legal dependencies, and scenario artifacts on demand.
3. **Status is never color-only** — every status indicator pairs color with an icon and a text label (draft / in review / approved / signed off; healthy / stale / failing).
4. **Restraint over spectacle** — this is a high-trust public-sector instrument. Motion is functional (orientation, feedback, hierarchy), never decorative. No scroll-jacking, no parallax heroes inside the app; expressive motion is reserved for the landing page.
5. **Low-bandwidth friendly** — skeletons, incremental rendering, text-first fallbacks for maps/charts, offline shell for PWA.
6. **Printable by default** — briefs, memos, and dashboards have print styles that preserve evidence traceability (citation list printed at end of document).

---

## 2. Color Palette (dark-first, low-saturation "civic ink" theme)

Primary experience is a dark, calm, institutional theme. Semantic tokens are defined so a light variant can follow without re-designing components.

| Token | Hex | Usage |
|---|---|---|
| `bg-base` | `#0B1220` | App background (deep ink navy) |
| `bg-surface` | `#101A2E` | Cards, panels, sidebar |
| `bg-elevated` | `#16233C` | Drawers, modals, popovers, hover states |
| `bg-inset` | `#080E1A` | Code blocks, map canvas, chart plots |
| `border-subtle` | `#1E2C47` | Hairline dividers, card borders (1px) |
| `border-strong` | `#2C3F63` | Focus rings (with accent), table headers |
| `text-primary` | `#E6ECF5` | Headings, primary data |
| `text-secondary` | `#9AA8BF` | Labels, descriptions |
| `text-muted` | `#5E6D87` | Captions, timestamps, empty states |
| `accent-primary` | `#3FAE9E` | Desaturated institutional teal — primary actions, active nav, links, map highlight |
| `accent-primary-strong` | `#63C7B8` | Hover state for accent |
| `accent-secondary` | `#6C8BD4` | Muted periwinkle — secondary series in charts, info accents |
| `gold` | `#C9A24B` | Executive/official accents — seal, governor-tier highlights, "signed off" |
| `status-success` | `#4FAE8C` | Healthy, high confidence, approved |
| `status-warning` | `#D9A441` | Stale data, medium confidence, pending review |
| `status-danger` | `#D9635F` | Failed pipelines, low confidence, blocked, risks |
| `status-info` | `#5E93CF` | Running jobs, informational |
| `confidence-high` | `#4FAE8C` | Confidence ≥ 0.75 (label: "High confidence") |
| `confidence-med` | `#D9A441` | 0.5–0.75 ("Medium confidence") |
| `confidence-low` | `#D9635F` | < 0.5 ("Low confidence — human review required") |

**Charts:** categorical series `['#3FAE9E', '#6C8BD4', '#C9A24B', '#8B7BC7', '#5E93CF', '#7FAE6E']`. Uncertainty bands render as the series color at 12% opacity fill with a dashed 1px upper/lower bound stroke. Gridlines `#1E2C47` at 50% opacity; axis labels `text-muted`.

**Login page** uses the same palette with a full-bleed topographic asset (`/auth-topo.png`).

---

## 3. Typography

Google Fonts: **IBM Plex Sans** (UI), **IBM Plex Mono** (data, metrics, IDs, code), **IBM Plex Serif** (official documents: brief/memo previews, citations, quotes — confers public-document gravitas).

| Style | Font / Size / Weight / Tracking | Usage |
|---|---|---|
| Display | Plex Sans 32/40, 600, -0.02em | Page titles |
| H1 | Plex Sans 24/32, 600, -0.01em | Section headers |
| H2 | Plex Sans 18/26, 600 | Card titles, panel headers |
| Body | Plex Sans 14/22, 400 | Default UI text |
| Body small | Plex Sans 13/20, 400 | Dense tables, secondary text |
| Caption | Plex Sans 12/16, 500, +0.04em, uppercase | Labels, eyebrows, status text |
| Metric XL | Plex Mono 34/40, 500 | Executive KPI numbers |
| Metric | Plex Mono 20/28, 500 | Card metrics, table numerals |
| Mono small | Plex Mono 12/18, 400 | IDs, request IDs, hashes, timestamps |
| Document | Plex Serif 15/26, 400 | Brief/memo preview body |
| Document H | Plex Serif 20/30, 600 | Brief/memo headings |

Numerals always tabular (`font-variant-numeric: tabular-nums`). Minimum body size 12px (captions only); interactive text ≥ 13px.

---

## 4. Spacing, Layout, Shape

- **Spacing scale:** 4px base — 4, 8, 12, 16, 24, 32, 48, 64.
- **Radius:** 6px cards/buttons, 10px panels/drawers, 999px pills/badges. Restrained — no large bubbly radii.
- **Elevation:** flat-first. Cards = `bg-surface` + 1px `border-subtle`. Elevated overlays get `0 8px 32px rgba(2,6,16,0.5)`.
- **Grid:** 12-col fluid, 24px gutters. Max content width 1600px centered with 32px page padding (24px tablet, 16px mobile).
- **Density:** comfortable default; tables support a compact toggle (row height 44px → 36px).

---

## 5. Motion & Animation Style

**Philosophy:** motion communicates state and causality. Durations are short; nothing blocks work.

- **Easings:** standard `cubic-bezier(0.2, 0, 0, 1)` (ease-out-biased); entrance `cubic-bezier(0.16, 1, 0.3, 1)`; exit `cubic-bezier(0.7, 0, 0.84, 0)`.
- **Durations:** micro (hover/press) 120ms; UI transitions 180–240ms; drawer/modal 280ms; page transition 240ms; skeleton shimmer 1.6s loop.
- **Page transitions (Framer Motion):** fade + 8px rise on content container, 240ms, exit 160ms fade. Sidebar/topbar remain stable (no re-animation).
- **List/card entrances:** stagger children 0.05s, translateY 12px → 0, opacity 0 → 1, only on first mount (not on re-render/filter — filtering uses layout animation with 200ms FLIP instead).
- **Counters:** executive KPI numbers count up over 800ms on first view (ease-out), then static.
- **Micro-interactions:** buttons scale 0.98 on press + 120ms color shift; icon buttons get a 2px accent underline sweep; nav items slide a 3px accent bar on the left edge (160ms).
- **Drawers/modals:** right-side drawers slide in 280ms with 24px offset; backdrop fades to rgba(4,8,18,0.6); ESC and backdrop click close; focus trapped.
- **Charts:** animate in over 600ms (series draw-in, band fade). On data change, transition 400ms, never re-mount.
- **Running jobs:** status dot pulses (1.8s, opacity 0.4↔1); progress bars use a subtle 8px striped shimmer.
- **Reduced motion:** `prefers-reduced-motion` disables counters, staggers, pulses, and chart draw-in (instant render).
- **Landing page exception:** the public landing page may use GSAP/ScrollTrigger storytelling (see `home.md`) — inside the app shell, no scroll-driven effects.

---

## 6. Accessibility & Print

- WCAG 2.2 AA contrast (all tokens above meet 4.5:1 on their backgrounds).
- Full keyboard navigation; visible focus rings (2px `accent-primary` outer ring + 2px offset).
- Every status has icon + text label; confidence shown as label + numeric score + segmented bar (never color alone).
- `aria-live` regions for async job status (simulation runs, brief generation, opportunity generation).
- Print stylesheet: light-on-white inversion, expands collapsed evidence sections, appends numbered citation list, hides nav/interactive chrome, adds "Generated [timestamp] · Request ID [id] · Approval state [state]" footer on every page.

---

## 7. App Shell

### 7.1 Sidebar (desktop ≥1280px, 264px wide; collapsed 72px icon rail; tablet overlay; mobile bottom nav)

- **Header block (64px):** Meridian seal mark (`/logo-mark.svg`) + wordmark "MERIDIAN / Policy Twin" (two-line, caption + H2). Collapse toggle.
- **Jurisdiction selector:** prominent select card under header — "Kaduna State · Nigeria" with chevron; opens a hierarchical picker (Federal → State → LGA → Ward) with search. This scopes every screen.
- **Primary nav** (icon + label, active = accent bar + `bg-elevated`):
  1. Executive Dashboard
  2. Opportunity Explorer
  3. Policy & Legislation Workbench
  4. Simulation Studio
  5. Executive Briefs
  6. Data Source Health
  7. Copilot (with a subtle accent dot when a conversation is in progress)
- **Secondary nav (bottom-pinned):** Documents library, Audit log (admin/steward roles), Settings, Help & keyboard shortcuts (`?`).
- **User card (bottom):** avatar initials, name, role label ("Governor · Executive"), overflow menu (profile, sign out).

### 7.2 Topbar (64px, sticky)

- Left: current page title + breadcrumb context (e.g., "Kaduna State / Education").
- Center: global search input (⌘K command palette — searches opportunities, laws, clauses, briefs, runs, and triggers copilot queries).
- Right cluster:
  - **Data freshness chip:** "Data as of 12 Jan 2025" with status dot (green ≤ 7 days, amber ≤ 30, red older) — clicking opens Data Source Health.
  - **Jobs indicator:** bell-style icon with running async jobs (simulation runs, brief generations); popover lists jobs with live status (polls tRPC).
  - **Approval queue badge:** count of items awaiting the current user's sign-off (executive/legal roles).
  - **Offline/PWA status icon:** appears only when offline ("Offline — showing cached data").
  - Role switcher (demo builds), avatar.

### 7.3 Responsive / PWA / native

- **≥1280px:** full sidebar. **768–1279px:** icon rail; drawers become full-width panels; compare views stack. **<768px:** bottom navigation (5 slots: Dashboard, Explorer, Workbench, Studio, More), top bar condensed (search icon, freshness chip, avatar); drawers become bottom sheets; tables become stacked record cards.
- **PWA:** installable (manifest + icons), service worker caches app shell + last-viewed jurisdiction datasets; offline banner; "Install app" menu item. Safe-area insets respected for the Capacitor native shells (Android/iOS); native shell adds haptic feedback on primary actions and biometric unlock gate.

---

## 8. Shared Components (used across pages)

- **ExecutiveStatCard** — label (caption), big mono metric, delta vs prior period (↑/↓ + value), sparkline, confidence chip, "evidence" link opening EvidenceDrawer.
- **ConfidenceChip** — segmented 3-bar meter + label ("High · 0.86") + tooltip listing evidence count, freshness, model agreement.
- **ApprovalBadge** — states: `Draft`, `In review`, `Approved`, `Signed off` (gold seal icon), `Returned`. Always with icon + text.
- **EvidenceDrawer** — right drawer (480px): cited sources list (document title, issuer, date, relevance score), clause excerpts, lineage graph mini-view, dataset freshness, "open full document" links. Every AI/simulation output links here.
- **StatusDot + label** — pipeline/job status (healthy/stale/failing/running/queued/succeeded).
- **FilterBar** — sticky under page header: sector multi-select, geography tree-select, horizon (1/3/5-yr), confidence floor slider, saved views dropdown.
- **DataTable** — sortable headers, mono numerals, row hover `bg-elevated`, expandable rows (evidence preview), compact toggle, export CSV.
- **MapPanel** — LGA/ward choropleth (Kaduna State), layer toggles (opportunity score, unemployment, school density, travel-time catchments), zoom to selection, legend, "view data as table" fallback toggle (low-bandwidth).
- **UncertaintyBandChart** — line + 80% credible-interval band; hover crosshair with mono readouts; toggle between runs in compare mode.
- **ApprovalHandoffCard** — summary of item, current state, next approver, comment field, Approve / Return with comments buttons (disabled with tooltip for unauthorized roles).
- **ExportMenu** — Memo (DOCX), Executive brief (PDF), Presentation (PPTX), Print. Each export records an audit event; menu item shows last export time.
- **CommandPalette** (⌘K) — fuzzy search across entities; "Ask Copilot…" affordance at bottom.
- **EmptyState** — mono icon, one-line guidance, primary action. Low-saturation, no illustrations except `/empty-evidence.svg` spot art.
- **SkeletonCard / SkeletonTable** — shimmer placeholders matching final layout exactly (no layout shift).

---

## 9. Data & API Binding Notes (tRPC envelope)

All screens consume the standard envelope `{ data, meta: { request_id, correlation_id, api_version }, audit: { actor_id, generated_at } }`. UI displays `request_id` in export footers and evidence drawers. Async operations (opportunity generation, simulation runs, brief generation) return a job handle; the Jobs indicator polls status and toasts on completion. Idempotency keys are generated per user-initiated action (visible in audit log).

Demo/seed domain: Kaduna State, 23 LGAs; sectors: Education, SME Formation, Public Procurement, Agro-processing, Digital Services; headline target: **250,000 new jobs by 2027**.

---

## 10. Page List

| File | Route | Description |
|---|---|---|
| `home.md` | `/` | Public landing + platform overview + sign-in (Keycloak) entry |
| `dashboard.md` | `/dashboard` | Governor executive dashboard — KPI cards, sector highlights, job targets, risks, scenario summaries, memo/export |
| `opportunities.md` | `/opportunities` | Sector opportunity explorer — ranked opportunities, filters, map, evidence drawers, compare view |
| `legislation.md` | `/legislation` | Policy & legislation workbench — clause navigation, dependency graph, citation trace, review workflow, draft export |
| `simulation.md` | `/simulation` | Simulation studio — scenario builder, assumptions editor, run compare, uncertainty bands, artifacts |
| `briefs.md` | `/briefs` | Executive brief generator — templates, async generation, approval handoff, presentation & print |
| `data-health.md` | `/data-health` | Data source health console — pipelines, freshness, failures, review queues, contract compliance |
| `copilot.md` | `/copilot` | Conversational copilot — grounded answers with citations, evidence bundles, uncertainty indicators |

---

## 11. Assets Manifest

The app is primarily typographic/data-driven (maps and charts are rendered from data, not images). Only these assets are needed:

| Filename | Description | Location | Dimensions | Type |
|---|---|---|---|---|
| `logo-mark.svg` | Abstract civic seal: a hexagonal badge formed by concentric topographic contour rings converging on a single point (a jurisdiction "twin"); strokes in `#3FAE9E` with a `#C9A24B` center point; flat, geometric, no text; works at 24px and 512px. | Sidebar header, login, favicon, PWA icon basis | 512×512 1:1 | SVG |
| `auth-topo.png` | Full-bleed dark background: very subtle topographic contour lines of an abstract river-delta terrain, deep ink navy `#0B1220` base, contours in slightly lighter `#16233C` with a few faint teal `#3FAE9E` ridge lines; soft vignette; no text, no recognizable geography; calm and institutional. | Landing/login page background | 2560×1440 16:9 | Image |
| `pwa-icon-512.png` | `logo-mark.svg` rendered on `bg-base` rounded-square tile with 12% padding. | PWA manifest, native splash | 512×512 1:1 | Image |
| `empty-evidence.svg` | Minimal line-art spot illustration: three stacked document sheets with a magnifier and a small link/chain glyph, single-weight strokes in `#5E6D87` with one `#3FAE9E` accent stroke; flat, geometric. | Empty states (evidence drawer, search, review queues) | 320×240 4:3 | SVG |
| `og-cover.png` | Social/OG card: logo-mark left, "Meridian Policy Twin — Evidence before policy" in IBM Plex Sans on `bg-base`, faint topo texture, gold hairline rule. | Landing page meta | 1200×630 | Image |

---

## 12. Dependencies (for implementation)

Tailwind CSS 3.4, shadcn/ui (Radix primitives: dialog, drawer→custom sheet, popover, command, tabs, accordion, select, slider, table, tooltip, dropdown-menu), Framer Motion (app transitions/micro-interactions), GSAP + ScrollTrigger (landing page only), Recharts or visx (charts w/ uncertainty bands), MapLibre GL (choropleth; raster fallback: static SVG Nigeria/Kaduna LGA map), Lucide icons, Google Fonts (IBM Plex Sans/Serif/Mono), Vite PWA plugin.
