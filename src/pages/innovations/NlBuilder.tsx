import { useState } from "react";
import { MessageSquareText, Copy, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { ConfidenceChip, EmptyState } from "@/components/shared";
import InnovationPage, { InnovationError } from "@/components/innovations/InnovationPage";
import {
  useParseScenarioText,
  type ParseScenarioResult,
} from "@/lib/innovations-client";
import { JURISDICTION_ID } from "@/components/dashboard/utils";

const EXAMPLES = [
  "Spend ₦500m on teacher recruitment in Kaduna over 3 years",
  "Subsidise solar mini-grids for 40 rural wards with a ₦1.2bn budget",
  "Run a 24-month primary healthcare staffing programme across all LGAs",
];

const FIELD_LABELS: Record<string, string> = {
  name: "Scenario name",
  sector_code: "Sector",
  interventions: "Interventions",
  budget_ngn: "Budget",
  horizon_months: "Horizon",
  models: "Models",
};

const naira = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  maximumFractionDigits: 0,
});

function fieldValue(result: ParseScenarioResult, field: string): string {
  const c = result.config;
  switch (field) {
    case "name":
      return c.name;
    case "sector_code":
      return c.sector_code ?? "—";
    case "interventions":
      return c.interventions.join(", ") || "—";
    case "budget_ngn":
      return c.budget_ngn != null ? naira.format(c.budget_ngn) : "—";
    case "horizon_months":
      return c.horizon_months != null ? `${c.horizon_months} months` : "—";
    case "models":
      return c.models.join(", ") || "—";
    default:
      return "—";
  }
}

export default function NlBuilder() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<ParseScenarioResult | null>(null);
  const [copied, setCopied] = useState(false);

  const parseM = useParseScenarioText({
    onSuccess: (r) => setResult(r),
  });

  const parse = () => parseM.mutate({ text, jurisdiction_id: JURISDICTION_ID });

  const copyConfig = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.config, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const fields = result
    ? Object.keys(FIELD_LABELS).filter(
        (f) => f in result.field_confidence || f in (result.config as unknown as Record<string, unknown>),
      )
    : [];

  return (
    <InnovationPage
      title="Natural-Language Scenario Builder"
      description="Describe a policy scenario in plain language. The parser extracts a structured scenario config — review every field's confidence before using it."
      Icon={MessageSquareText}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------- input --------------------------- */}
        <div className="space-y-3">
          <label htmlFor="nl-text" className="text-sm font-semibold text-ink-primary">
            Describe your scenario
          </label>
          <textarea
            id="nl-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder={EXAMPLES[0]}
            className="w-full rounded-md border border-ink-subtle bg-ink-inset px-3 py-2.5 text-[14px] leading-6 text-ink-primary outline-none placeholder:text-ink-muted focus:border-civic"
          />
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                type="button"
                onClick={() => setText(ex)}
                className="rounded-full border border-ink-subtle bg-ink-elevated px-2.5 py-1 text-[11px] text-ink-secondary hover:border-civic/50 hover:text-ink-primary"
              >
                {ex}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={text.trim().length < 10 || parseM.isPending}
            onClick={parse}
            className="rounded-md bg-civic px-4 py-2 text-sm font-medium text-ink-base transition-transform enabled:hover:bg-civic-strong enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {parseM.isPending ? "Parsing…" : "Parse scenario"}
          </button>
          <div aria-live="polite">
            {parseM.isError && <InnovationError error={parseM.error} onRetry={parse} />}
          </div>
        </div>

        {/* --------------------------- result --------------------------- */}
        <div aria-live="polite" className="space-y-3">
          {!result && !parseM.isPending && (
            <EmptyState
              Icon={MessageSquareText}
              showSpotArt={false}
              title="Nothing parsed yet"
              guidance="Type or pick an example prompt, then parse. Extracted fields appear here with per-field confidence."
            />
          )}
          {result && (
            <>
              {result.needs_review.length > 0 && (
                <div className="rounded-md border border-status-warning/40 bg-status-warning/10 p-3">
                  <p className="flex items-center gap-1.5 text-[13px] font-semibold text-ink-primary">
                    <AlertTriangle aria-hidden className="h-4 w-4 text-status-warning" />
                    Needs review
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-[12px] text-ink-secondary">
                    {result.needs_review.map((f) => (
                      <li key={f}>{FIELD_LABELS[f] ?? f}</li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className="space-y-2">
                {fields.map((f) => {
                  const conf = result.field_confidence[f];
                  const needsReview = result.needs_review.includes(f);
                  return (
                    <li
                      key={f}
                      className={cn(
                        "flex items-start justify-between gap-3 rounded-md border p-3",
                        needsReview
                          ? "border-status-warning/50 bg-status-warning/5"
                          : "border-ink-subtle bg-ink-surface",
                      )}
                    >
                      <div className="min-w-0">
                        <p className="caption-label text-ink-muted">{FIELD_LABELS[f] ?? f}</p>
                        <p className="mt-0.5 break-words text-[13px] text-ink-primary">
                          {fieldValue(result, f)}
                        </p>
                      </div>
                      {conf != null && <ConfidenceChip score={conf} />}
                    </li>
                  );
                })}
              </ul>

              <div className="rounded-md border border-ink-subtle bg-ink-surface p-3.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold text-ink-primary">Scenario config</h3>
                  <button
                    type="button"
                    onClick={copyConfig}
                    className="inline-flex items-center gap-1 rounded-md border border-ink-subtle px-2 py-1 text-[11px] text-ink-secondary hover:border-ink-strong"
                  >
                    {copied ? (
                      <Check aria-hidden className="h-3.5 w-3.5 text-status-success" />
                    ) : (
                      <Copy aria-hidden className="h-3.5 w-3.5" />
                    )}
                    {copied ? "Copied" : "Copy JSON"}
                  </button>
                </div>
                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-ink-inset p-2.5 font-mono text-[11px] leading-4 text-ink-secondary">
                  {JSON.stringify(result.config, null, 2)}
                </pre>
                <p className="mt-2 text-[11px] leading-4 text-ink-muted">
                  To open in Simulation Studio: copy this JSON, go to{" "}
                  <a href="/simulation" className="text-civic hover:underline">
                    /simulation
                  </a>
                  , and create a new scenario — paste the config into the advanced/import field.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </InnovationPage>
  );
}
