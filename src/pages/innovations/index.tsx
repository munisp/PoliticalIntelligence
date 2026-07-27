import { Link, Route, Routes } from "react-router";
import {
  Compass,
  Wallet,
  Store,
  MessageSquareText,
  ClipboardList,
  ScrollText,
  Scale,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { LocaleProvider } from "@/lib/LocaleContext";
import { cn } from "@/lib/utils";
import Onboarding from "./Onboarding";
import Optimizer from "./Optimizer";
import Marketplace from "./Marketplace";
import NlBuilder from "./NlBuilder";
import FieldData from "./FieldData";
import AuditExplorer from "./AuditExplorer";
import LegalQa from "./LegalQa";

interface InnovationCard {
  path: string;
  title: string;
  description: string;
  Icon: LucideIcon;
  tag: string;
}

const CARDS: InnovationCard[] = [
  {
    path: "onboarding",
    title: "Jurisdiction Onboarding",
    description:
      "Import a new jurisdiction from a config pack — real data from live sources where available, the rest honestly labeled as seed.",
    Icon: Compass,
    tag: "Data",
  },
  {
    path: "optimizer",
    title: "Budget Portfolio Optimizer",
    description:
      "Allocate a budget across interventions under risk and sector-cap constraints; see binding constraints and expected jobs.",
    Icon: Wallet,
    tag: "Planning",
  },
  {
    path: "marketplace",
    title: "Scenario Marketplace",
    description:
      "Install reviewed scenario templates from other jurisdictions, or publish your own through the human-review gate.",
    Icon: Store,
    tag: "Collaboration",
  },
  {
    path: "nl-builder",
    title: "Natural-Language Scenario Builder",
    description:
      "Describe a policy scenario in plain language; review the extracted config field-by-field before opening it in the studio.",
    Icon: MessageSquareText,
    tag: "AI",
  },
  {
    path: "field-data",
    title: "Field Data Collection",
    description:
      "Offline-first facility surveys for field officers — queue submissions without connectivity, auto-sync on reconnect.",
    Icon: ClipboardList,
    tag: "Data",
  },
  {
    path: "audit",
    title: "Audit Explorer",
    description:
      "Immutable event timeline with cursor pagination, filters, hash-chain verification, and JSON export of audit slices.",
    Icon: ScrollText,
    tag: "Governance",
  },
  {
    path: "legal-qa",
    title: "Legal QA / IAA Board",
    description:
      "Legislation review queue with two-annotator agreement scoring, confidence heat bars, and reassignment.",
    Icon: Scale,
    tag: "Governance",
  },
];

function Gallery() {
  return (
    <div className="space-y-5 pb-24">
      <header>
        <p className="caption-label text-ink-muted">Meridian Policy Twin</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-[-0.01em] text-ink-primary">
          <Sparkles aria-hidden className="h-5 w-5 text-civic" />
          Platform Innovations
        </h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-secondary">
          New capabilities under active rollout. Pages degrade gracefully while
          their backend services ship — provenance labels always distinguish
          live, derived, and seed data.
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map(({ path, title, description, Icon, tag }) => (
          <li key={path}>
            <Link
              to={path}
              className={cn(
                "group flex h-full flex-col gap-2 rounded-md border border-ink-subtle bg-ink-surface p-4",
                "transition-colors hover:border-civic/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-civic",
              )}
            >
              <span className="flex items-center justify-between">
                <span
                  aria-hidden
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-ink-subtle bg-ink-elevated"
                >
                  <Icon className="h-4 w-4 text-civic" strokeWidth={1.5} />
                </span>
                <span className="rounded-full border border-ink-subtle bg-ink-elevated px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-muted">
                  {tag}
                </span>
              </span>
              <span className="text-sm font-semibold text-ink-primary group-hover:text-civic">
                {title}
              </span>
              <span className="text-[12px] leading-4 text-ink-secondary">{description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Nested router for /innovations/* (mounted as a single route in App.tsx). */
export default function InnovationsRouter() {
  return (
    <LocaleProvider>
      <Routes>
        <Route index element={<Gallery />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="optimizer" element={<Optimizer />} />
        <Route path="marketplace" element={<Marketplace />} />
        <Route path="nl-builder" element={<NlBuilder />} />
        <Route path="field-data" element={<FieldData />} />
        <Route path="audit" element={<AuditExplorer />} />
        <Route path="legal-qa" element={<LegalQa />} />
      </Routes>
    </LocaleProvider>
  );
}
