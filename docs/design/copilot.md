# Conversational Copilot (`/copilot`)

**Primary users:** all approved roles (SR-8); read-only tool — never publishes.
**Purpose:** grounded conversational decision support. Every answer is assembled from hybrid retrieval (SQL + vector + graph) and **must** show citations, an evidence bundle, and uncertainty indicators. The copilot advises; humans decide.

---

## Page Layout

App shell with a focused three-zone layout: **conversation list rail (280px, collapsible)** · **chat canvas (fluid, max 860px centered)** · **context/evidence panel (360px, right, collapsible)**. On smaller screens the right panel becomes a bottom sheet; the rail collapses to an overlay.

### Rail — Conversations

- "New conversation" primary button at top; list of prior conversations: first-line preview, mono timestamp, jurisdiction scope chip, message count. Search field filters live.
- **Animation:** rows stagger 0.04s rise 8px; new conversation inserts at top with 200ms slide.

### Chat canvas

**Empty state (new conversation):**
- Centered: logo-mark, H1 "Ask with evidence", caption "Answers cite their sources and show confidence. Copilot never publishes or approves."
- Suggested prompts grid (2×2 cards, role-aware): executive — "Which sectors are furthest from their job targets?"; analyst — "Compare SME credit uptake scenarios from last month"; legal — "What does the Procurement Law say about SME set-asides?"; steward — "Which sources feeding the education model are stale?"
- **Animation:** suggestions stagger 0.08s rise 14px; hover lift -3px (160ms); clicking one sends it.

**Message thread:**
- User messages: right-aligned, `bg-elevated` bubble, max 70% width.
- Assistant answers: left-aligned, **no bubble** — document-style block on transparent background (evidence-first register): prose in Body, with **inline citation markers** `[1][2]` (periwinkle, hover → 220ms popover with source title/issuer/date/relevance; click → pins source in right panel).
- **Answer footer strip** (the signature element, always visible): ConfidenceChip (label + score, e.g., "Medium confidence · 0.68") · retrieval provenance chips (mono small: "SQL 6 · Vector 14 · Graph 3") · model tier chip ("qwen3-32b") · "Evidence bundle (9)" button (opens right panel) · feedback icons (helpful / not — records audit event).
- **Uncertainty indicator:** when retrieval is thin or model agreement is low, an amber banner sits above the answer: "Low certainty — 2 of 9 sources are stale and models disagree. Treat as directional only." with a "Why?" expander listing contributing factors.
- **Structured payloads:** answers can embed interactive artifacts inline — a mini ranked table (top 5 opportunities, sortable), an UncertaintyBandChart (simulation follow-ups), a clause quote card (serif, gold left bar, links into Workbench), or a KPI delta card. Each artifact carries its own ConfidenceChip and "Open in [screen] →" deep link.
- **Typing/streaming:** assistant responses stream token-by-token (body text); while retrieving, a status line shows phases with crossfading captions: "Searching sources… → Reading 9 documents… → Assembling answer…" plus a teal progress hairline.
- Composer (sticky bottom): multiline input (Enter send, Shift+Enter newline), jurisdiction scope chip (inherits shell selector), attachment button (ground against a specific document/brief), "Deep analysis" toggle (routes to specialist tier DeepSeek-R1 — caption "slower, for hard analysis"), send button. Disabled state with tooltip when offline: "Copilot requires connectivity — cached conversations remain readable."
- **Animation:** messages enter with 12px rise + fade (200ms); citation popovers 220ms; phase captions crossfade 300ms; inline artifacts draw per their own chart rules.

### Right panel — Evidence bundle & context

- Tabs: **Evidence bundle** · **Conversation context**.
- Evidence bundle: numbered source cards matching inline markers — title, issuer, date, type chip (Dataset / Legal clause / Document / Simulation run), relevance bar, freshness StatusDot, "Open source →" (deep link to Workbench/Documents/Explorer). Header: mono small "request_id · retrieval: hybrid (SQL+vector+graph)".
- Conversation context: entities referenced (jurisdictions, sectors, runs) as chips; clicking pins that entity filter for follow-ups; "Export conversation as memo section" (adds to Brief composer with citations intact — audit event).
- **Animation:** panel slides 280ms; source cards stagger 0.05s; relevance bars draw 400ms staggered.

## Guardrails (visible, not hidden)

- Persistent caption under composer: "Copilot answers are advisory. Policy and legal actions require human review in the Workbench."
- If a user asks for an action (publish/approve), copilot replies with a refusal-pattern card: "I can't approve outputs — route this through the approval workflow." + deep-link button.
- Rate/scope limits shown as captions, never silent failures.

## Responsive

- ≥1280px: three zones. 768–1279px: rail hidden behind hamburger overlay; evidence panel becomes bottom sheet triggered by the "Evidence bundle" button. <768px: single column; citations open popovers; composer is full-width sticky with safe-area inset (native shell).

## Interactions checklist

⌘K anywhere in app → "Ask Copilot…" pre-fills a new conversation. Deep-linkable conversations (`/copilot?c=...`). Full keyboard navigation of thread; citation markers focusable with popover on focus. Streaming uses aria-live polite with final answer announced once. Export/print of a conversation appends the numbered source list and request_id.

## Assets

- `/empty-evidence.svg` (no prior conversations / empty evidence bundle — variant caption "No sources retrieved"). No other images; artifacts are data-rendered.
