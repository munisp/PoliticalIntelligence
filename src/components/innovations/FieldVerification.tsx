import { useMemo, useState } from "react";
import { MapPin, LocateFixed } from "lucide-react";
import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrapData } from "@/components/dashboard/utils";
import { EmptyState, SkeletonTable } from "@/components/shared";

interface VerificationRow {
  verification_id: string;
  verdict: "confirmed" | "disputed" | "needs_review";
  gps_lat: number;
  gps_lng: number;
  notes: string | null;
  created_at: string | Date;
}

const VERDICT_STYLES: Record<string, string> = {
  confirmed: "border-status-success/50 bg-status-success/10 text-status-success",
  disputed: "border-rose-500/50 bg-rose-500/10 text-rose-500",
  needs_review: "border-status-warning/50 bg-status-warning/10 text-status-warning",
};

/**
 * I10 — Field verification loop: GPS-stamped verdict form (browser
 * geolocation) + verification list for an entity.
 */
export default function FieldVerification() {
  const t = useT();
  const utils = trpc.useUtils();
  const [entityType, setEntityType] = useState<"milestone" | "project" | "metric">("project");
  const [entityRef, setEntityRef] = useState("");
  const [verdict, setVerdict] = useState<"confirmed" | "disputed" | "needs_review">("confirmed");
  const [notes, setNotes] = useState("");
  const [gps, setGps] = useState<{ lat: number; lng: number } | null>(null);
  const [gpsError, setGpsError] = useState(false);

  const listQ = trpc.field.list.useQuery(
    { entity_type: entityType, entity_ref: entityRef },
    { enabled: entityRef.trim().length > 0 },
  );
  const rows = useMemo(
    () => (unwrapData(listQ.data) as VerificationRow[] | undefined) ?? [],
    [listQ.data],
  );

  const verifyM = trpc.field.verify.useMutation({
    onSuccess: () => {
      setNotes("");
      void utils.field.list.invalidate();
    },
  });

  const captureGps = () => {
    setGpsError(false);
    if (!("geolocation" in navigator)) {
      setGpsError(true);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setGpsError(true),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  };

  const valid = entityRef.trim().length > 0 && gps != null;

  return (
    <section className="mt-4 grid gap-4 lg:grid-cols-2">
      {/* --------------------------- form --------------------------- */}
      <form
        aria-label={t.field.title}
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || !gps) return;
          verifyM.mutate({
            entity_type: entityType,
            entity_ref: entityRef.trim(),
            gps_lat: gps.lat,
            gps_lng: gps.lng,
            verdict,
            notes: notes.trim() || undefined,
          });
        }}
        className="space-y-3 rounded-md border border-ink-subtle bg-ink-surface p-4"
      >
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink-primary">
          <MapPin aria-hidden className="h-4 w-4 text-civic" />
          {t.field.title}
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[12px] font-medium text-ink-secondary">
            {t.field.entityType}
            <select
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as typeof entityType)}
              className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
            >
              <option value="milestone">milestone</option>
              <option value="project">project</option>
              <option value="metric">metric</option>
            </select>
          </label>
          <label className="block text-[12px] font-medium text-ink-secondary">
            {t.field.entityRef}
            <input
              required
              value={entityRef}
              onChange={(e) => setEntityRef(e.target.value)}
              placeholder="series:12:2025-06"
              className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 font-mono text-[13px] text-ink-primary outline-none focus:border-civic"
            />
          </label>
        </div>
        <label className="block text-[12px] font-medium text-ink-secondary">
          {t.field.verdict}
          <select
            value={verdict}
            onChange={(e) => setVerdict(e.target.value as typeof verdict)}
            className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
          >
            <option value="confirmed">{t.field.confirmed}</option>
            <option value="disputed">{t.field.disputed}</option>
            <option value="needs_review">{t.field.needsReview}</option>
          </select>
        </label>
        <label className="block text-[12px] font-medium text-ink-secondary">
          {t.field.notes}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={4000}
            className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={captureGps}
            className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-3 py-1.5 text-[12px] text-ink-secondary hover:border-civic/50 hover:text-civic"
          >
            <LocateFixed aria-hidden className="h-3.5 w-3.5" />
            {t.field.captureGps}
          </button>
          {gps && (
            <span className="font-mono text-[11px] text-status-success">
              {t.field.gpsCaptured}: {gps.lat.toFixed(5)}, {gps.lng.toFixed(5)}
            </span>
          )}
          {gpsError && (
            <span className="text-[11px] text-status-warning">{t.field.gpsError}</span>
          )}
        </div>
        <button
          type="submit"
          disabled={!valid || verifyM.isPending}
          className="w-full rounded-md bg-civic px-4 py-2 text-sm font-medium text-ink-base enabled:hover:bg-civic-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          {t.field.submit}
        </button>
        <div aria-live="polite">
          {verifyM.isSuccess && (
            <p className="text-[12px] text-status-success">{t.field.submitted}</p>
          )}
          {verifyM.isError && (
            <p className="text-[12px] text-status-warning">{t.field.submitError}</p>
          )}
        </div>
      </form>

      {/* --------------------------- list --------------------------- */}
      <div className="space-y-2">
        {entityRef.trim() === "" ? (
          <EmptyState
            Icon={MapPin}
            showSpotArt={false}
            title={t.field.title}
            guidance={t.field.empty}
          />
        ) : listQ.isLoading ? (
          <SkeletonTable rows={3} />
        ) : rows.length === 0 ? (
          <p className="text-[12px] text-ink-muted">{t.field.empty}</p>
        ) : (
          <ul className="space-y-2">
            {rows.map((v) => (
              <li
                key={v.verification_id}
                className="rounded-md border border-ink-subtle bg-ink-surface p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${VERDICT_STYLES[v.verdict] ?? ""}`}
                  >
                    {v.verdict}
                  </span>
                  <span className="font-mono text-[11px] text-ink-muted">
                    {v.gps_lat.toFixed(4)}, {v.gps_lng.toFixed(4)}
                  </span>
                </div>
                {v.notes && (
                  <p className="mt-1 text-[12px] text-ink-secondary">{v.notes}</p>
                )}
                <p className="mt-0.5 font-mono text-[10px] text-ink-muted">
                  {new Date(v.created_at).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
