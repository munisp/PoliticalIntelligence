# Landing / Overview Page (`/`)

**Purpose:** public-facing entry to the Meridian Policy Twin platform. Introduces the product to government stakeholders, establishes trust (evidence-first, sovereign-ready, human review), and funnels to secure sign-in (Keycloak SSO). This is the only page with expressive scroll storytelling — inside the app, motion becomes strictly functional.

**Audience:** governors, chiefs of staff, ministry leadership, delivery partners, technical evaluators.

---

## Layout Shell

- Fixed top nav (72px, `bg-base` 80% + backdrop-blur 12px, bottom hairline `border-subtle`): logo-mark + "MERIDIAN Policy Twin" left; nav links center (Platform, Evidence, Simulation, Security, Pilot); right: "Sign in" ghost button + "Request pilot briefing" primary teal button.
- Background: `auth-topo.png` fixed at 20% opacity behind hero, fading to pure `bg-base` by second section.
- Footer: 3 columns (Platform: Dashboard, Workbench, Simulation; Governance: Evidence & audit, Security, Accessibility; Pilot: Nigeria deployment, Contact PMO). Bottom bar: "Sovereign-ready · Open-source stack · WCAG 2.2 AA" + mini seal.

---

## Section 1 — Hero (100vh)

- **Layout:** two-column, 12-col grid. Left (7 cols): eyebrow caption "JURISDICTION ECONOMIC INTELLIGENCE · NIGERIA PILOT", Display headline (56px desktop): **"Evidence before policy. Simulation before spending."** Sub (18px, text-secondary, max 52ch): "Meridian gives governors and ministries a policy twin of their jurisdiction — ranked job-creation opportunities, clause-aware legislation analysis, and simulated outcomes — with every number traced to its evidence." CTA row: primary "Sign in to the platform" → `/login`; secondary "See the pilot dashboard" (demo entry → `/dashboard`).
- Right (5 cols): a **live-preview card stack** — three slightly fanned glass cards (`bg-elevated`, border-subtle, elevation) showing miniature real UI: (1) ExecutiveStatCard "Jobs supported YTD — 41,280" with teal sparkline, (2) an opportunity ranking row "Agro-processing clusters · Score 0.86 · High confidence", (3) an UncertaintyBandChart mini with dashed bounds. Each card shows a tiny ConfidenceChip and ApprovalBadge — the product's signature.
- Trust strip under CTAs: three mono-caption items with icons — "Qwen3 open-weight models", "Human review on all legal outputs", "Deploys on-prem / sovereign cloud".
- **Animation:** on load — headline splits word-level, words rise 24px + fade, stagger 0.06s (GSAP); sub and CTAs fade up 16px, delay 0.4s; card stack fans in from translateY 40px rotate(-2deg) with 0.12s stagger, delay 0.5s; background topo slowly drifts 2% over 20s (CSS keyframe, paused with reduced-motion).

## Section 2 — "The problem" stat band (auto height)

- Full-width band on `bg-surface` with hairline top/bottom borders. Four mono stats in a row (count-up on scroll): **"36 states + FCT"** modeled jurisdictions · **"774 LGAs"** ward-level spatial analysis · **"6 simulation engines"** forecast → agent-based · **"100%"** of high-impact outputs carry evidence + approval state.
- **Animation (GSAP ScrollTrigger):** trigger at 75% viewport; stats stagger 0.1s, translateY 24px → 0, opacity 0→1; numbers count up 1.2s ease-out.

## Section 3 — Capability pillars (3 × 2 cards)

- Section header: eyebrow "PLATFORM", H1 "One platform, five decision workflows".
- Cards (`bg-surface`, hover: border shifts to `border-strong`, icon container tilts 4°): 
  1. **Executive dashboard** — "Job targets, sector highlights, and risks on one page — memo-ready."
  2. **Opportunity explorer** — "Ranked, scored, and mapped opportunities with confidence and evidence."
  3. **Policy & legislation workbench** — "Clause-level retrieval, dependency paths, citation trace, drafting support."
  4. **Simulation studio** — "Six engines, seeded and auditable: forecast, causal, microsimulation, ABM, system dynamics, optimization."
  5. **Executive briefs** — "Structured briefs with approval handoff, presentation and print outputs."
  6. **Data health** — "Pipeline freshness, source contracts, review queues — trust you can inspect."
- **Animation:** cards stagger in 0.08s on scroll (rise 28px, opacity 0→1); hover lift -4px with shadow deepening (180ms).

## Section 4 — Evidence-first scroll story (pinned, 200vh)

- Pinned section: left side fixed text panel — H1 "Every recommendation shows its work." cycling three statements as scroll progresses: (a) **Confidence** — a score, not a shrug; (b) **Provenance** — every figure links to source documents, datasets, and lineage; (c) **Approval** — policy and legal outputs are never auto-published. Right side: a large EvidenceDrawer mock that swaps content per statement (confidence meter → provenance list → approval handoff card), crossfading.
- **Animation:** ScrollTrigger pin for 200vh; progress drives three 0→1 opacity/scale crossfades at 0.33/0.66 boundaries; left text switches with 12px slide; unpin releases to next section.

## Section 5 — Nigeria pilot (split panel)

- Left: eyebrow "REFERENCE DEPLOYMENT", H1 "Nigeria pilot — Kaduna State", body: "Federal → state → LGA → ward modeling. Pilot sectors: education, SME formation, and procurement-led job creation. Target: 250,000 new jobs by 2027." Bullet chips: "23 LGAs modeled", "Ward-level overlays", "Low-bandwidth & offline ready", "Multilingual-ready".
- Right: stylized map panel (MapPanel in presentation mode): Kaduna LGA choropleth, teal gradient legend "Opportunity score", hotspot pulse on two LGAs.
- **Animation:** panel slides in from right 40px on scroll trigger 70%; map layers fade in sequentially (base → choropleth → hotspots, 300ms each); hotspot pulse loops 2.4s.

## Section 6 — Security & governance band

- Three-column row of compact items with mono icons: **RBAC & audit** ("Keycloak-backed roles; immutable audit events on every view, prompt, run, and publication") · **Sovereign deployment** ("Public cloud, private cloud, on-prem; offline-capable PWA") · **Open-source stack** ("No vendor lock-in; engines replaceable behind stable interfaces").
- **Animation:** fade up stagger 0.1s at 75% trigger.

## Section 7 — Sign-in CTA (final)

- Centered: H1 "Ready to govern with evidence?" + primary "Sign in" + secondary "Request pilot briefing". Below in caption: "Authorized users only · All sessions audited".
- **Animation:** fade + rise 24px at 80% trigger; primary button has a subtle teal glow pulse (2.8s, box-shadow 0→12px rgba teal 0.25).

---

## Sign-in (`/login`, modal route over landing)

- Centered card (420px, `bg-elevated`): seal mark, H1 "Sign in to Meridian", caption "Kaduna State deployment · SSO via Keycloak". Fields: email, password (with reveal toggle). Primary button "Continue with government SSO". Secondary links: "Request access", "Forgot password". Footer caption: "Access is role-based and fully audited. Request ID shown on every session."
- Demo affordance (dev builds): "Explore with a demo role" dropdown listing the six roles; selecting one enters the app with that role's experience.
- **Animation:** card scales 0.96→1 + fade, 220ms; field focus rings animate 160ms; error states shake 3px twice.

---

## Assets

- `/logo-mark.svg` (nav, footer, login card)
- `/auth-topo.png` (hero + page background, 20% opacity)
- `/og-cover.png` (meta tags)
- Map in Section 5 is data-rendered (no image asset).

## Interactions checklist

Nav smooth-scrolls to sections (Lenis). All buttons have 120ms press feedback. Command palette is NOT active on landing (app-only). PWA install prompt appears in nav menu after first visit ("Install Meridian").
