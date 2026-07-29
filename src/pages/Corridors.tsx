import { trpc } from "@/providers/trpc";
import { useT } from "@/lib/LocaleContext";
import { unwrap } from "@/lib/trpc-data";
import CorridorPanel from "@/components/simulation/CorridorPanel";

/** I3 — Corridor Twin route (reached from Simulation; no nav addition). */
export default function Corridors() {
  const t = useT();
  const listQuery = trpc.corridors.list.useQuery();
  const corridors = unwrap<{ corridors: string[] }>(listQuery.data)?.corridors ?? [];
  const corridorId = corridors[0] ?? "corridor:lagos-calabar";
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header>
        <h1 className="text-xl font-semibold text-ink-primary">{t.corridors.title}</h1>
        <p className="mt-1 text-[13px] text-ink-muted">{t.corridors.subtitle}</p>
      </header>
      <CorridorPanel corridorId={corridorId} />
    </div>
  );
}
