# Opportunity Embed Widgets (I2)

Third-party sites can embed a sanitized opportunity card via the public
`embed` tRPC surface.

## API

- `embed.opportunityCard { opportunity_id }` — public, rate-limited
  (60 req/min per client, fixed window). Returns ONLY public fields:
  `title`, `sector`, `jurisdiction`, `summary`, `evidence_count`, `link`.
  Internal fields (score internals, review state, creator ids, provenance,
  evidence payloads) are never exposed.
- `embed.scriptTag { opportunity_id, theme? }` — returns an iframe-safe,
  script-free HTML snippet with inline styles; all dynamic text is
  HTML-escaped.

## Usage

1. On the Opportunities page, click **Embed** on any opportunity row.
2. Copy the snippet and paste it into your page HTML.

The snippet is a static card (`<div class="meridian-opp-card">`) linking back
to the canonical opportunity page — no JavaScript executes on the host page,
so it is safe for CMSs that strip `<script>` tags.

## Rate limiting & errors

- 60 requests/minute per client IP (hashed; never logged raw).
- Exceeding the limit returns `EMBED_RATE_LIMITED` (retryable).
- Unknown ids return `OPPORTUNITY_NOT_FOUND`.
