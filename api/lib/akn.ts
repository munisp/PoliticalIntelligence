/**
 * G4 local Akoma Ntoso 3.0 fallback builder — mirrors
 * services/documents/app/akn.py build_draft_akn so exportDraftAkn still
 * produces structurally valid AKN when the documents service is offline.
 */
import type { RiaAnnex } from "@contracts/drafting";

const AKN_NS = "http://docs.oasis-open.org/legaldocml/ns/akn/3.0";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function slugify(title: string, maxLen = 32): string {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "doc";
  return (
    words
      .slice(0, 6)
      .map((w) => w[0])
      .join("")
      .slice(0, maxLen) || words[0].slice(0, maxLen)
  );
}

function eid(sectionPath: string): string {
  return `sec_${sectionPath.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

export interface AknDraftClause {
  section_path: string;
  heading?: string | null;
  text: string;
  kind?: string;
}

export function buildDraftAkn(opts: {
  title: string;
  clauses: AknDraftClause[];
  ria?: RiaAnnex | null;
  country?: string;
  docType?: string;
  year?: number | null;
}): string {
  const country = opts.country ?? "ng";
  const docType = opts.docType ?? "bill";
  const year = opts.year ?? null;
  const slug = slugify(opts.title);
  const uri = `/akn/${country}/${docType}/${year ?? "undated"}/${slug}`;

  const frbr = (["Work", "Expression", "Manifestation"] as const)
    .map((level, i) => {
      const suffix = i === 0 ? "" : i === 1 ? "/eng@" : ".xml";
      return `<FRBR${level}><FRBRthis value="${uri}${suffix}"/><FRBRuri value="${uri}${suffix}"/><FRBRdate date="${year ?? "undated"}" name="${level.toLowerCase()}"/><FRBRauthor href="#author"/></FRBR${level}>`;
    })
    .join("");

  const body = opts.clauses
    .map((c) => {
      const container =
        c.kind === "article" ? "article" : "section";
      return `<${container} eId="${eid(c.section_path)}"><num>${esc(c.section_path)}</num>${
        c.heading ? `<heading>${esc(c.heading)}</heading>` : ""
      }<content><p>${esc(c.text)}</p></content></${container}>`;
    })
    .join("");

  const ria = opts.ria;
  const annex = ria
    ? `<annex eId="annex_ria"><num>Annex A</num><heading>Regulatory Impact Assessment</heading><content><p>${esc(
        ria.consensus_summary,
      )}</p><p>Point estimates: ${esc(
        ria.point_estimates
          .map(
            (p) =>
              `${p.metric} ${p.value} ${p.unit} (80% band ${p.lower}–${p.upper}, horizon ${p.horizon_months}m)`,
          )
          .join("; "),
      )}</p><p>Assumptions: ${esc(ria.assumptions.join("; "))}</p><p>Reproducibility hash: ${esc(
        ria.reproducibility_hash,
      )} (simulation run ${esc(ria.simulation_run_id)}, engine ${esc(ria.engine)})</p>${
        ria.citations.length > 0
          ? `<p>Citations: ${esc(
              ria.citations.map((c) => c.citation).join("; "),
            )}</p>`
          : ""
      }</content></annex>`
    : "";

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<akomaNtoso xmlns="${AKN_NS}"><act name="${docType}">` +
    `<meta><identification source="#meridian-documents">${frbr}</identification>` +
    `<references source="#meridian"/></meta>` +
    `<body>${body}</body>${annex}</act></akomaNtoso>`
  );
}
