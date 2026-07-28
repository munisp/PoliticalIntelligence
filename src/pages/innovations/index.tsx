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
import { LocaleProvider, useT } from "@/lib/LocaleContext";
import type { Dict } from "@/i18n";
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
  titleKey: keyof Dict["innovations"];
  descKey: keyof Dict["innovations"];
  Icon: LucideIcon;
  tagKey: keyof Dict["innovations"];
}

const CARDS: InnovationCard[] = [
  { path: "onboarding", titleKey: "onboardingTitle", descKey: "onboardingDesc", Icon: Compass, tagKey: "tagData" },
  { path: "optimizer", titleKey: "optimizerTitle", descKey: "optimizerDesc", Icon: Wallet, tagKey: "tagPlanning" },
  { path: "marketplace", titleKey: "marketplaceTitle", descKey: "marketplaceDesc", Icon: Store, tagKey: "tagCollaboration" },
  { path: "nl-builder", titleKey: "nlBuilderTitle", descKey: "nlBuilderDesc", Icon: MessageSquareText, tagKey: "tagAi" },
  { path: "field-data", titleKey: "fieldDataTitle", descKey: "fieldDataDesc", Icon: ClipboardList, tagKey: "tagData" },
  { path: "audit", titleKey: "auditTitle", descKey: "auditDesc", Icon: ScrollText, tagKey: "tagGovernance" },
  { path: "legal-qa", titleKey: "legalQaTitle", descKey: "legalQaDesc", Icon: Scale, tagKey: "tagGovernance" },
];

function Gallery() {
  const t = useT();
  return (
    <div className="space-y-5 pb-24">
      <header>
        <p className="caption-label text-ink-muted">{t.innovations.hubCaption}</p>
        <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-[-0.01em] text-ink-primary">
          <Sparkles aria-hidden className="h-5 w-5 text-civic" />
          {t.innovations.hubTitle}
        </h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-5 text-ink-secondary">
          {t.innovations.hubSubtitle}
        </p>
      </header>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CARDS.map(({ path, titleKey, descKey, Icon, tagKey }) => (
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
                  {t.innovations[tagKey]}
                </span>
              </span>
              <span className="text-sm font-semibold text-ink-primary group-hover:text-civic">
                {t.innovations[titleKey]}
              </span>
              <span className="text-[12px] leading-4 text-ink-secondary">{t.innovations[descKey]}</span>
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
