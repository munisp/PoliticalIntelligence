import { Link } from "react-router";

const COLUMNS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: "Platform",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "Workbench", href: "/legislation" },
      { label: "Simulation", href: "/simulation" },
    ],
  },
  {
    heading: "Governance",
    links: [
      { label: "Evidence & audit", href: "/data-health" },
      { label: "Security", href: "/#security" },
      { label: "Accessibility", href: "/#security" },
    ],
  },
  {
    heading: "Pilot",
    links: [
      { label: "Nigeria deployment", href: "/#pilot" },
      { label: "Contact PMO", href: "/#cta" },
    ],
  },
];

/** Minimal footer — landing page only (the app shell has no footer). */
export default function Footer() {
  return (
    <footer className="border-t border-ink-subtle bg-ink-surface">
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 py-12 sm:grid-cols-3">
        {COLUMNS.map((col) => (
          <nav key={col.heading} aria-label={col.heading}>
            <h3 className="caption-label text-ink-muted">{col.heading}</h3>
            <ul className="mt-3 space-y-2">
              {col.links.map((l) => (
                <li key={l.label}>
                  <Link
                    to={l.href}
                    className="text-[13px] text-ink-secondary hover:text-civic"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-ink-subtle">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <p className="text-xs text-ink-muted">
            Sovereign-ready · Open-source stack · WCAG 2.2 AA
          </p>
          <img src="/logo-mark.svg" alt="" className="h-6 w-6 opacity-70" />
        </div>
      </div>
    </footer>
  );
}
