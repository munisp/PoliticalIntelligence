import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ClipboardList, Landmark, Lightbulb, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import IdeaIntake from "@/components/advocacy/IdeaIntake";
import PathwaysTab from "@/components/advocacy/PathwaysTab";
import ChecklistTab from "@/components/advocacy/ChecklistTab";
import StakeholderMap from "@/components/advocacy/StakeholderMap";
import {
  unwrapData,
  type StakeholderMapData,
} from "@/components/advocacy/types";

type TabId = "intake" | "pathways" | "stakeholders" | "checklist";

function StakeholderMapTab() {
  const t = useT();
  const mapQuery = trpc.advocacy.stakeholderMap.useQuery({});
  const data: StakeholderMapData | null = useMemo(
    () => (mapQuery.data ? unwrapData<StakeholderMapData>(mapQuery.data) : null),
    [mapQuery.data],
  );

  if (mapQuery.isLoading) {
    return (
      <div
        aria-busy="true"
        aria-label={t.advocacy.mapLoading}
        className="flex h-[520px] items-center justify-center rounded-md border border-ink-subtle bg-ink-surface/60 text-[13px] text-ink-muted"
      >
        {t.advocacy.mapLoading}
      </div>
    );
  }
  if (mapQuery.isError) {
    return (
      <p
        role="alert"
        className="rounded-md border border-status-danger/40 bg-status-danger/10 p-4 text-[13px] text-status-danger"
      >
        {t.advocacy.mapError}
      </p>
    );
  }
  return <StakeholderMap nodes={data?.nodes ?? []} edges={data?.edges ?? []} />;
}

export default function Advocacy() {
  const t = useT();
  const [tab, setTab] = useState<TabId>("intake");
  // Pathway selection shared between the Pathways and Checklist tabs.
  const [selectedPathwayId, setSelectedPathwayId] = useState<string | null>(null);

  const TABS: { id: TabId; label: string; Icon: typeof Lightbulb }[] = [
    { id: "intake", label: t.advocacy.tabIntake, Icon: Lightbulb },
    { id: "pathways", label: t.advocacy.tabPathways, Icon: Landmark },
    { id: "stakeholders", label: t.advocacy.tabStakeholders, Icon: Users },
    { id: "checklist", label: t.advocacy.tabChecklist, Icon: ClipboardList },
  ];

  return (
    <div className="flex flex-col">
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="mb-4"
      >
        <p className="caption-label text-ink-muted">{t.advocacy.caption}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-[-0.01em] text-ink-primary md:text-[32px] md:leading-10">
          {t.advocacy.title}
        </h1>
        <p className="mt-1 text-[13px] text-ink-secondary">{t.advocacy.subtitle}</p>
      </motion.header>

      {/* Tab bar */}
      <div
        role="tablist"
        aria-label={t.advocacy.title}
        className="mb-4 flex flex-wrap gap-1 border-b border-ink-subtle"
      >
        {TABS.map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={active}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                active
                  ? "border-civic text-civic"
                  : "border-transparent text-ink-secondary hover:border-ink-strong hover:text-ink-primary",
              )}
            >
              <Icon aria-hidden className="h-4 w-4" />
              {label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel">
        {tab === "intake" && <IdeaIntake />}
        {tab === "pathways" && (
          <PathwaysTab
            selectedPathwayId={selectedPathwayId}
            onSelectPathway={setSelectedPathwayId}
          />
        )}
        {tab === "stakeholders" && <StakeholderMapTab />}
        {tab === "checklist" && (
          <ChecklistTab
            selectedPathwayId={selectedPathwayId}
            onSelectPathway={setSelectedPathwayId}
          />
        )}
      </div>
    </div>
  );
}
