import { useMemo, useState } from "react";
import { ScrollText, ShieldCheck, ShieldAlert, Download, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/providers/trpc";
import { unwrap } from "@/lib/trpc-data";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState, SkeletonTable } from "@/components/shared";
import InnovationPage, { InnovationError } from "@/components/innovations/InnovationPage";
import { useT } from "@/lib/LocaleContext";
import { useVerifyAuditChain } from "@/lib/innovations-client";

interface AuditEventRow {
  eventId: number;
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string | null;
  correlationId: string | null;
  createdAt: string | Date;
}

interface AuditPage {
  items: AuditEventRow[];
  next_cursor: string | null;
}

export default function AuditExplorer() {
  const t = useT();
  const { isAuthenticated } = useAuth();
  const [entityType, setEntityType] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [actorFilter, setActorFilter] = useState("");
  const [cursors, setCursors] = useState<string[]>([]); // stack of prior cursors
  const cursor = cursors[cursors.length - 1];

  const auditQ = trpc.ops.auditLog.useQuery(
    {
      entity_type: entityType || undefined,
      cursor,
      limit: 50,
    },
    { enabled: isAuthenticated, retry: false },
  );
  const chainQ = useVerifyAuditChain({ enabled: isAuthenticated, retry: false });

  const page = useMemo(
    () => unwrap<AuditPage>(auditQ.data as unknown as null) ?? null,
    [auditQ.data],
  );
  const items = useMemo(() => {
    const rows = page?.items ?? [];
    return rows.filter(
      (r) =>
        (!actionFilter || r.action.toLowerCase().includes(actionFilter.toLowerCase())) &&
        (!actorFilter || String(r.actorId ?? "").includes(actorFilter)),
    );
  }, [page, actionFilter, actorFilter]);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), items }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-slice-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const chain = chainQ.data;

  return (
    <InnovationPage
      title={t.innovations.auditTitle}
      description="Immutable, append-only event timeline. Every mutation on the platform is recorded with actor, request id, and payload — verifiable as a hash chain."
      Icon={ScrollText}
      actions={
        <button
          type="button"
          onClick={exportJson}
          disabled={items.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-3 py-1.5 text-[13px] text-ink-secondary hover:border-ink-strong disabled:opacity-40"
        >
          <Download aria-hidden className="h-4 w-4" /> Export JSON
        </button>
      }
    >
      {/* ------------------- chain verification ------------------- */}
      <div
        aria-live="polite"
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-md border px-3.5 py-2.5",
          chainQ.isLoading
            ? "border-ink-subtle bg-ink-surface"
            : chain?.valid
              ? "border-gold/50 bg-gold/10"
              : chain && !chain.valid
                ? "border-status-danger/50 bg-status-danger/10"
                : "border-ink-subtle bg-ink-surface",
        )}
      >
        {chainQ.isLoading && <span className="text-[13px] text-ink-muted">Verifying chain…</span>}
        {chainQ.isError && (
          <span className="text-[13px] text-ink-muted">
            Chain verification service unavailable yet.
          </span>
        )}
        {chain?.valid && (
          <>
            <ShieldCheck aria-hidden className="h-5 w-5 text-gold" />
            <span className="text-[13px] font-medium text-ink-primary">
              Chain verified — {chain.entries.toLocaleString()} entries intact
            </span>
            <span className="rounded-full border border-gold/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-gold">
              Sealed
            </span>
          </>
        )}
        {chain && !chain.valid && (
          <>
            <ShieldAlert aria-hidden className="h-5 w-5 text-status-danger" />
            <span className="text-[13px] font-medium text-ink-primary">
              Audit chain broken — investigate immediately.
            </span>
            {chain.first_broken_id && (
              <span className="font-mono text-[11px] text-status-danger">
                first broken entry: {chain.first_broken_id}
              </span>
            )}
          </>
        )}
      </div>

      {/* ------------------------- filters ------------------------- */}
      <div className="flex flex-wrap gap-2">
        <label className="text-[12px] text-ink-muted">
          <span className="sr-only">Filter by entity type</span>
          <input
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setCursors([]);
            }}
            placeholder="Entity type (e.g. scenario)"
            className="rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-1.5 text-[12px] text-ink-primary outline-none placeholder:text-ink-muted focus:border-civic"
          />
        </label>
        <label className="text-[12px] text-ink-muted">
          <span className="sr-only">Filter by action</span>
          <input
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            placeholder="Action contains…"
            className="rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-1.5 text-[12px] text-ink-primary outline-none placeholder:text-ink-muted focus:border-civic"
          />
        </label>
        <label className="text-[12px] text-ink-muted">
          <span className="sr-only">Filter by actor</span>
          <input
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            placeholder="Actor id…"
            className="rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-1.5 text-[12px] text-ink-primary outline-none placeholder:text-ink-muted focus:border-civic"
          />
        </label>
      </div>

      {/* ------------------------- timeline ------------------------- */}
      {auditQ.isLoading && <SkeletonTable rows={8} />}
      {auditQ.isError && (
        <InnovationError error={auditQ.error} onRetry={() => void auditQ.refetch()} />
      )}
      {page && items.length === 0 && (
        <EmptyState
          Icon={ScrollText}
          showSpotArt={false}
          title="No audit events match"
          guidance="Loosen the filters or paginate further back."
        />
      )}
      <ol className="relative space-y-0 border-l border-ink-subtle pl-4">
        {items.map((e) => (
          <li key={e.eventId} className="relative pb-4">
            <span
              aria-hidden
              className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-ink-base bg-civic"
            />
            <div className="rounded-md border border-ink-subtle bg-ink-surface p-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[12px] font-medium text-ink-primary">
                  {e.action}
                </span>
                <span className="text-[12px] text-ink-secondary">
                  {e.entityType} <span className="font-mono text-ink-muted">{e.entityId}</span>
                </span>
                <span className="text-[11px] text-ink-muted">
                  actor {e.actorId ?? "system"} · {new Date(e.createdAt).toLocaleString()}
                </span>
              </div>
              {e.requestId && (
                <p className="mt-1 font-mono text-[10px] text-ink-muted">
                  req {e.requestId}
                  {e.correlationId ? ` · corr ${e.correlationId}` : ""}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={cursors.length === 0}
          onClick={() => setCursors((c) => c.slice(0, -1))}
          className="rounded-md border border-ink-subtle px-3 py-1.5 text-[12px] text-ink-secondary disabled:opacity-40"
        >
          Newer
        </button>
        <button
          type="button"
          disabled={!page?.next_cursor}
          onClick={() => page?.next_cursor && setCursors((c) => [...c, page.next_cursor!])}
          className="inline-flex items-center gap-1 rounded-md border border-ink-subtle px-3 py-1.5 text-[12px] text-ink-secondary disabled:opacity-40"
        >
          Older <ChevronDown aria-hidden className="h-3.5 w-3.5" />
        </button>
      </div>
    </InnovationPage>
  );
}
