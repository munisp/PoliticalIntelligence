/**
 * Server-side brief renderer (G5 / SR-5 residual gap): turns a brief record
 * into rendered export artifacts.
 *
 * Formats:
 *  - "html": standalone HTML document, inline CSS, print-optimized
 *    (@page margins, screen-only elements stripped, page-break rules) —
 *    also the PDF-ready source (print-to-PDF from any viewer).
 *  - "doc": Word-compatible HTML saved with a .doc extension plus the MIME
 *    preamble Word expects. NOTE: no DOCX library is available in
 *    node_modules and heavy dependencies are intentionally not added — this
 *    is the documented, dependency-free Word export path.
 *
 * Document sections: title block, jurisdiction, generated-at, executive
 * summary, body sections, numbered + linked citations rail, provenance
 * footer (origin tags, run manifest hash when attached), audit request_id.
 */

export interface RenderableCitation {
  evidence_source_id: string;
  citation: string;
}

export interface RenderableSection {
  heading: string;
  body: string;
}

export interface RenderableBrief {
  briefId: string;
  jurisdictionId: string;
  title: string;
  reviewState: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  signedOffAt?: Date | string | null;
  content: {
    title?: string;
    sections?: RenderableSection[];
    citations_rail?: RenderableCitation[];
  } | null;
  modelRouting: {
    tier?: string;
    model?: string;
    fallback?: boolean;
    run_manifest_hash?: string;
  } | null;
}

export interface RenderOptions {
  /** Audit request id stamped in the footer. */
  requestId: string | null;
  /** Override generated-at (defaults to brief.updatedAt). */
  generatedAt?: Date | string;
}

export type RenderedFormat = "html" | "doc";

export interface RenderedArtifact {
  format: RenderedFormat;
  filename: string;
  mimeType: string;
  content: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function iso(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? String(d) : dt.toISOString();
}

function slug(id: string): string {
  return id.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const CSS = `
  @page { margin: 2.2cm 2cm; }
  * { box-sizing: border-box; }
  body { font-family: Georgia, 'Times New Roman', serif; color: #1a2332;
         line-height: 1.55; margin: 0; padding: 24px; max-width: 800px; }
  .title-block { border-bottom: 2px solid #b08d2f; padding-bottom: 12px;
                 margin-bottom: 20px; }
  .title-block .eyebrow { font-family: Arial, sans-serif; font-size: 10px;
        letter-spacing: 0.12em; text-transform: uppercase; color: #b08d2f; }
  h1 { font-size: 22px; margin: 6px 0 8px; }
  .meta { font-family: Arial, sans-serif; font-size: 11px; color: #5a6678; }
  .meta span { margin-right: 16px; }
  h2 { font-size: 16px; margin: 20px 0 6px; page-break-after: avoid; }
  p.body { font-size: 13.5px; margin: 0 0 10px; }
  sup a { color: #2a7d6f; text-decoration: none; font-family: Arial,
          sans-serif; font-size: 10px; }
  section.brief-section { page-break-inside: avoid; }
  .citations { margin-top: 26px; border-top: 1px solid #c8ced8;
               padding-top: 10px; page-break-inside: avoid; }
  .citations h2 { font-family: Arial, sans-serif; font-size: 12px;
        text-transform: uppercase; letter-spacing: 0.08em; color: #5a6678; }
  .citations ol { font-size: 12.5px; padding-left: 22px; }
  .citations li { margin-bottom: 5px; }
  .citations .eid { font-family: 'Courier New', monospace; font-size: 10px;
        color: #5a6678; }
  .provenance { margin-top: 26px; border-top: 1px solid #c8ced8;
        padding-top: 8px; font-family: 'Courier New', monospace;
        font-size: 10px; color: #5a6678; }
  .exec-summary { background: #f5f2ea; border-left: 3px solid #b08d2f;
        padding: 10px 14px; margin-bottom: 18px; page-break-inside: avoid; }
  @media print { body { padding: 0; } a { color: inherit; } }
`;

/** Numbered, anchor-linked citations rail. */
function citationsHtml(citations: RenderableCitation[]): string {
  if (citations.length === 0) return "";
  const items = citations
    .map(
      (c, i) =>
        `<li id="citation-${i + 1}">${escapeHtml(c.citation)} ` +
        `<span class="eid">${escapeHtml(c.evidence_source_id)}</span></li>`,
    )
    .join("");
  return `<nav class="citations" aria-label="Cited sources"><h2>Cited sources</h2><ol>${items}</ol></nav>`;
}

function bodyHtml(brief: RenderableBrief): { exec: string; rest: string } {
  const sections = brief.content?.sections ?? [];
  const citations = brief.content?.citations_rail ?? [];
  // Deterministic citation markers: up to two markers per section, cycling
  // through the rail — mirrors the on-screen preview behavior.
  const renderSection = (s: RenderableSection, i: number) => {
    let markers = "";
    for (let k = 0; k < Math.min(2, citations.length); k++) {
      const n = (i * 2 + k) % citations.length;
      markers +=
        `<sup><a href="#citation-${n + 1}" title="${escapeHtml(citations[n].citation)}">[${n + 1}]</a></sup>`;
    }
    return `<h2>${escapeHtml(s.heading)}</h2><p class="body">${escapeHtml(s.body)}${markers}</p>`;
  };
  const [first, ...others] = sections;
  const exec = first
    ? `<div class="exec-summary"><h2>${escapeHtml(first.heading)}</h2><p class="body">${escapeHtml(first.body)}</p></div>`
    : "";
  const rest = others
    .map((s, i) => `<section class="brief-section">${renderSection(s, i + 1)}</section>`)
    .join("");
  return { exec, rest };
}

function provenanceHtml(brief: RenderableBrief, opts: RenderOptions): string {
  const routing = brief.modelRouting ?? {};
  const origin = routing.fallback
    ? "template-assembled (offline tier)"
    : `serving tier ${routing.tier ?? "unknown"}`;
  const parts = [
    `Origin: ${origin}`,
    `Model: ${routing.model ?? "deterministic"}`,
  ];
  if (routing.run_manifest_hash) {
    parts.push(`Run manifest: ${escapeHtml(routing.run_manifest_hash)}`);
  }
  parts.push(`Generated: ${iso(opts.generatedAt ?? brief.updatedAt)}`);
  parts.push(`Approval state: ${brief.reviewState}`);
  if (brief.signedOffAt) parts.push(`Signed off: ${iso(brief.signedOffAt)}`);
  parts.push(`Audit request_id: ${opts.requestId ?? "—"}`);
  return `<footer class="provenance" data-testid="provenance">${parts.join(" · ")}</footer>`;
}

/** Render a brief to a standalone, print-optimized HTML document. */
export function renderBriefHtml(
  brief: RenderableBrief,
  opts: RenderOptions,
): string {
  const citations = brief.content?.citations_rail ?? [];
  const { exec, rest } = bodyHtml(brief);
  const title = brief.content?.title ?? brief.title;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
<header class="title-block">
  <div class="eyebrow">Meridian Policy Twin · Executive brief · Official — Internal</div>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    <span>Jurisdiction: ${escapeHtml(brief.jurisdictionId)}</span>
    <span>Ref: ${escapeHtml(brief.briefId)}</span>
    <span>Generated: ${iso(opts.generatedAt ?? brief.updatedAt)}</span>
  </div>
</header>
${exec}
${rest}
${citationsHtml(citations)}
${provenanceHtml(brief, opts)}
</body>
</html>`;
}

/** Word-compatible HTML export (.doc). See module docstring — no DOCX dep. */
export function renderBriefDoc(
  brief: RenderableBrief,
  opts: RenderOptions,
): string {
  return (
    "MIME-Version: 1.0\n" +
    'Content-Type: text/html; charset="utf-8"\n' +
    "X-Document-Type: Word-compatible HTML\n\n" +
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word">` +
    renderBriefHtml(brief, opts).replace(/^<!DOCTYPE html>\s*<html[^>]*>/, "") +
    `</html>`
  );
}

export function renderBrief(
  brief: RenderableBrief,
  format: RenderedFormat,
  opts: RenderOptions,
): RenderedArtifact {
  const base = `brief-${slug(brief.briefId)}`;
  if (format === "doc") {
    return {
      format,
      filename: `${base}.doc`,
      mimeType: "application/msword",
      content: renderBriefDoc(brief, opts),
    };
  }
  return {
    format: "html",
    filename: `${base}.html`,
    mimeType: "text/html",
    content: renderBriefHtml(brief, opts),
  };
}
