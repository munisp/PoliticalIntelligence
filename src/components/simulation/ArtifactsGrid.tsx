import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  FileJson,
  FileText,
  FileArchive,
  Download,
  Link2,
  Check,
  Loader2,
  FolderOpen,
} from "lucide-react";
import JSZip from "jszip";
import { cn } from "@/lib/utils";
import EmptyState from "@/components/shared/EmptyState";
import { SkeletonCard } from "@/components/shared/Skeleton";
import { engineMeta } from "./engines";
import {
  artifactFileName,
  checksumPrefix,
  copyText,
  downloadJson,
  formatDateTime,
  shortRunId,
  type RunRow,
} from "./studio";

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

export interface ArtifactsGridProps {
  runs: RunRow[];
  isLoading: boolean;
}

function iconFor(uri: string) {
  if (uri.endsWith(".json")) return FileJson;
  if (uri.endsWith(".zip")) return FileArchive;
  return FileText;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ArtifactsGrid({ runs, isLoading }: ArtifactsGridProps) {
  const artifactRuns = useMemo(
    () => runs.filter((r) => r.status === "succeeded" && r.artifactUri),
    [runs],
  );
  const [runFilter, setRunFilter] = useState<string>("all");
  const visible =
    runFilter === "all"
      ? artifactRuns
      : artifactRuns.filter((r) => r.simulationRunId === runFilter);
  const [zipping, setZipping] = useState(false);

  const downloadAll = async () => {
    setZipping(true);
    try {
      const zip = new JSZip();
      for (const r of visible) {
        zip.file(
          `${r.scenarioId}/${artifactFileName(r.artifactUri ?? `${r.simulationRunId}.json`)}`,
          JSON.stringify(
            {
              simulation_run_id: r.simulationRunId,
              scenario_id: r.scenarioId,
              scenario: r.scenarioName,
              engine: r.engine,
              seed: r.seed,
              model_versions: r.modelVersions,
              execution_profile: r.executionProfile,
              result_summary: r.resultSummary,
              artifact_uri: r.artifactUri,
            },
            null,
            2,
          ),
        );
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "simulation-artifacts.zip";
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setZipping(false);
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonCard key={i} metric={false} lines={3} />
        ))}
      </div>
    );
  }

  if (artifactRuns.length === 0) {
    return (
      <EmptyState
        Icon={FolderOpen}
        showSpotArt={false}
        title="No artifacts yet"
        guidance="Artifacts (result snapshots, engine logs, reports) are sealed when a run succeeds."
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Batch bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-ink-subtle bg-ink-surface px-3 py-2">
        <label className="flex items-center gap-2 text-xs text-ink-secondary">
          <span className="caption-label text-ink-muted">Run</span>
          <select
            value={runFilter}
            onChange={(e) => setRunFilter(e.target.value)}
            aria-label="Filter artifacts by run"
            className="rounded border border-ink-subtle bg-ink-inset px-2 py-1 font-mono text-xs text-ink-primary"
          >
            <option value="all">All runs ({artifactRuns.length})</option>
            {artifactRuns.map((r) => (
              <option key={r.simulationRunId} value={r.simulationRunId}>
                {shortRunId(r.simulationRunId)} · {r.scenarioName}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void downloadAll()}
          disabled={zipping || visible.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md border border-ink-subtle px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:border-civic/50 hover:text-civic disabled:opacity-50"
        >
          {zipping ? (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FileArchive aria-hidden className="h-3.5 w-3.5" />
          )}
          Download all (.zip)
        </button>
      </div>

      {/* Card grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((r, i) => (
          <ArtifactCard key={r.simulationRunId} run={r} index={i} />
        ))}
      </div>
    </div>
  );
}

function ArtifactCard({ run, index }: { run: RunRow; index: number }) {
  const uri = run.artifactUri ?? "";
  const Icon = iconFor(uri);
  const [checksum, setChecksum] = useState<string>("…");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    let alive = true;
    void checksumPrefix(uri).then((c) => {
      if (alive) setChecksum(c);
    });
    return () => {
      alive = false;
    };
  }, [uri]);

  const size = run.resultSummary
    ? new Blob([JSON.stringify(run.resultSummary)]).size
    : null;

  const download = () => {
    setDownloading(true);
    try {
      downloadJson(artifactFileName(uri) || `${run.simulationRunId}.json`, {
        simulation_run_id: run.simulationRunId,
        scenario_id: run.scenarioId,
        scenario: run.scenarioName,
        engine: run.engine,
        seed: run.seed,
        model_versions: run.modelVersions,
        result_summary: run.resultSummary,
        artifact_uri: run.artifactUri,
      });
    } finally {
      setTimeout(() => setDownloading(false), 400);
    }
  };

  const copy = async () => {
    const ok = await copyText(uri);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, delay: index * 0.05, ease: EASE }}
      className="rounded-md border border-ink-subtle bg-ink-surface p-3.5"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-md border border-ink-subtle bg-ink-inset">
          <Icon aria-hidden className="h-4 w-4 text-civic" />
        </span>
        <span className="rounded-full border border-ink-subtle px-2 py-0.5 font-mono text-[10px] text-ink-muted">
          {engineMeta(run.engine).tag}
        </span>
      </div>
      <p className="mt-2.5 truncate font-mono text-xs text-ink-primary" title={uri}>
        {artifactFileName(uri)}
      </p>
      <dl className="mt-1.5 space-y-1 font-mono text-[11px] text-ink-muted">
        <div className="flex justify-between gap-2">
          <dt>run</dt>
          <dd className="text-ink-secondary">{shortRunId(run.simulationRunId)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>size</dt>
          <dd className="text-ink-secondary">{size != null ? formatBytes(size) : "—"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>sha256</dt>
          <dd className="text-ink-secondary">{checksum}…</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>sealed</dt>
          <dd className="text-ink-secondary">{formatDateTime(run.finishedAt)}</dd>
        </div>
      </dl>
      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={download}
          disabled={downloading}
          className={cn(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-civic px-2.5 py-1.5 text-xs font-medium text-ink-base",
            "transition-all duration-150 hover:bg-civic-strong active:scale-[0.98] disabled:opacity-60",
          )}
        >
          {downloading ? (
            <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download aria-hidden className="h-3.5 w-3.5" />
          )}
          Download
        </button>
        <button
          type="button"
          onClick={() => void copy()}
          title="Copy artifact URI"
          aria-label={`Copy artifact URI for ${artifactFileName(uri)}`}
          className="inline-flex items-center gap-1 rounded-md border border-ink-subtle px-2.5 py-1.5 text-xs text-ink-secondary hover:border-civic/50 hover:text-civic"
        >
          {copied ? (
            <Check aria-hidden className="h-3.5 w-3.5 text-status-success" />
          ) : (
            <Link2 aria-hidden className="h-3.5 w-3.5" />
          )}
          {copied ? "Copied" : "Copy URI"}
        </button>
      </div>
    </motion.article>
  );
}
