import { useCallback, useEffect, useState } from "react";
import { ClipboardList, WifiOff, Wifi, CloudUpload, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnlineStatus } from "@/hooks/use-pwa";
import { EmptyState, SkeletonTable, StatusDot } from "@/components/shared";
import { ProvenanceChip } from "@/components/provenance";
import InnovationPage, { InnovationError } from "@/components/innovations/InnovationPage";
import FieldVerification from "@/components/innovations/FieldVerification";
import {
  useFieldDataList,
  useFieldDataSubmit,
  type FieldDataSubmitInput,
} from "@/lib/innovations-client";
import { JURISDICTION_ID } from "@/components/dashboard/utils";
import { useT } from "@/lib/LocaleContext";

const QUEUE_KEY = "meridian.fieldData.queue";

interface QueuedSubmission extends FieldDataSubmitInput {
  offline_id: string;
  queued_at: string;
}

function loadQueue(): QueuedSubmission[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as QueuedSubmission[];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedSubmission[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {
    /* storage full/unavailable */
  }
}

const FACILITY_TYPES = ["Primary school", "Secondary school", "Primary health centre", "General hospital", "Water point", "Market"];

export default function FieldData() {
  const t = useT();
  const online = useOnlineStatus();
  const [queue, setQueue] = useState<QueuedSubmission[]>(loadQueue);
  const [syncing, setSyncing] = useState(false);
  const [form, setForm] = useState({
    name: "",
    type: FACILITY_TYPES[0],
    ward: "",
    headcount: "",
    has_power: false,
  });

  const listQ = useFieldDataList(JURISDICTION_ID);
  const submitM = useFieldDataSubmit();

  /* Auto-sync queued submissions when connectivity returns. offline_id makes
     each retry idempotent server-side. */
  const syncQueue = useCallback(async () => {
    const pending = loadQueue();
    if (pending.length === 0) return;
    setSyncing(true);
    const remaining: QueuedSubmission[] = [];
    for (const item of pending) {
      try {
        await submitM.mutateAsync({
          jurisdiction_id: item.jurisdiction_id,
          form: item.form,
          payload: item.payload,
          offline_id: item.offline_id,
        });
      } catch {
        remaining.push(item);
      }
    }
    saveQueue(remaining);
    setQueue(remaining);
    setSyncing(false);
  }, [submitM]);

  useEffect(() => {
    if (online) void syncQueue();
  }, [online, syncQueue]);

  const valid = form.name.trim() && form.ward.trim() && Number(form.headcount) >= 0;

  const submit = () => {
    const payload = {
      name: form.name.trim(),
      type: form.type,
      ward: form.ward.trim(),
      headcount: Number(form.headcount) || 0,
      has_power: form.has_power,
      photo: null as string | null, // photo capture placeholder (low-bandwidth build)
    };
    const input: QueuedSubmission = {
      jurisdiction_id: JURISDICTION_ID,
      form: "facility_survey_v1",
      payload,
      offline_id: crypto.randomUUID(),
      queued_at: new Date().toISOString(),
    };
    if (online) {
      submitM.mutate(input, {
        onError: () => {
          const q = [...loadQueue(), input];
          saveQueue(q);
          setQueue(q);
        },
      });
    } else {
      const q = [...loadQueue(), input];
      saveQueue(q);
      setQueue(q);
    }
    setForm({ name: "", type: FACILITY_TYPES[0], ward: "", headcount: "", has_power: false });
  };

  const submissions = listQ.data ?? [];

  return (
    <InnovationPage
      title={t.innovations.fieldDataTitle}
      description="Offline-first facility surveys for field officers. Submissions queue locally without connectivity and sync automatically on reconnect — each carries a provenance label."
      Icon={ClipboardList}
      actions={
        <span
          role="status"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]",
            online
              ? "border-status-success/40 bg-status-success/10 text-status-success"
              : "border-status-warning/40 bg-status-warning/10 text-status-warning",
          )}
        >
          {online ? <Wifi aria-hidden className="h-3.5 w-3.5" /> : <WifiOff aria-hidden className="h-3.5 w-3.5" />}
          {online ? t.status.online : t.status.offline}
          {queue.length > 0 && (
            <span className="font-mono">· {queue.length} queued{syncing ? " · syncing…" : ""}</span>
          )}
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------- form --------------------------- */}
        <form
          aria-label="Facility survey"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) submit();
          }}
          className="space-y-3 rounded-md border border-ink-subtle bg-ink-surface p-4"
        >
          <h2 className="text-sm font-semibold text-ink-primary">Facility survey</h2>
          <label className="block text-[12px] font-medium text-ink-secondary">
            Facility name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
            />
          </label>
          <label className="block text-[12px] font-medium text-ink-secondary">
            Facility type
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
              className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
            >
              {FACILITY_TYPES.map((ft) => (
                <option key={ft}>{ft}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-[12px] font-medium text-ink-secondary">
              Ward
              <input
                required
                value={form.ward}
                onChange={(e) => setForm({ ...form, ward: e.target.value })}
                className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 text-[13px] text-ink-primary outline-none focus:border-civic"
              />
            </label>
            <label className="block text-[12px] font-medium text-ink-secondary">
              Headcount
              <input
                required
                inputMode="numeric"
                value={form.headcount}
                onChange={(e) => setForm({ ...form, headcount: e.target.value.replace(/[^\d]/g, "") })}
                className="mt-1 w-full rounded-md border border-ink-subtle bg-ink-inset px-2.5 py-2 font-mono text-[13px] text-ink-primary outline-none focus:border-civic"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink-primary">
            <input
              type="checkbox"
              checked={form.has_power}
              onChange={(e) => setForm({ ...form, has_power: e.target.checked })}
              className="h-4 w-4 accent-civic"
            />
            Facility has reliable power
          </label>
          <button
            type="button"
            disabled
            title="Photo capture ships in the full PWA build"
            className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-md border border-dashed border-ink-subtle px-3 py-2 text-[12px] text-ink-muted"
          >
            <Camera aria-hidden className="h-4 w-4" /> Add photo (coming soon)
          </button>
          <button
            type="submit"
            disabled={!valid || submitM.isPending}
            className="w-full rounded-md bg-civic px-4 py-2 text-sm font-medium text-ink-base enabled:hover:bg-civic-strong disabled:cursor-not-allowed disabled:opacity-40"
          >
            {online ? t.action.submit : "Queue offline"}
          </button>
          <div aria-live="polite">
            {submitM.isError && online && (
              <p className="text-[12px] text-status-warning">
                Could not reach the server — submission queued locally instead.
              </p>
            )}
            {submitM.isSuccess && (
              <p className="text-[12px] text-status-success">
                Submitted{submitM.data.deduped ? " (already received — deduplicated)" : ""}.
              </p>
            )}
          </div>
        </form>

        {/* ------------------------ submissions ------------------------ */}
        <div className="space-y-3">
          {queue.length > 0 && (
            <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3">
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-ink-primary">
                <CloudUpload aria-hidden className="h-4 w-4 text-status-warning" />
                {queue.length} submission{queue.length === 1 ? "" : "s"} queued offline
              </p>
              <ul className="mt-1.5 space-y-0.5 text-[12px] text-ink-secondary">
                {queue.map((q) => (
                  <li key={q.offline_id} className="flex items-center gap-2">
                    <StatusDot status="queued" />
                    {String(q.payload.name)} · {String(q.payload.ward)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {listQ.isLoading && <SkeletonTable rows={4} />}
          {listQ.isError && <InnovationError error={listQ.error} onRetry={() => void listQ.refetch()} />}
          {listQ.data && submissions.length === 0 && queue.length === 0 && (
            <EmptyState
              Icon={ClipboardList}
              showSpotArt={false}
              title="No submissions yet"
              guidance="Complete the facility survey to submit field data. It works fully offline."
            />
          )}
          <ul className="space-y-2">
            {submissions.map((s) => (
              <li
                key={s.submission_id}
                className="rounded-md border border-ink-subtle bg-ink-surface p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[13px] font-medium text-ink-primary">
                    {String(s.payload.name ?? s.form)}
                  </p>
                  <ProvenanceChip origin={s.origin ?? "live"} fetchedAt={s.created_at} />
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-ink-muted">
                  {String(s.payload.ward ?? "")} · headcount {String(s.payload.headcount ?? "—")} ·{" "}
                  {new Date(s.created_at).toLocaleString()} · by {s.submitted_by}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* I10 — Field verification loop (GPS + verdict + notes) */}
      <FieldVerification />
    </InnovationPage>
  );
}
