import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  AlertOctagon,
  ChevronRight,
  BookOpenText,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface RiskItem {
  id: string;
  severity: "high" | "moderate";
  title: string;
  meta: string;
  detail: string;
  mitigation: string;
}

/**
 * Top risks for the executive view. Content mirrors the jurisdiction risk
 * register (no dedicated API yet); each row links into the EvidenceDrawer.
 */
const RISKS: RiskItem[] = [
  {
    id: "risk:feeding-funding",
    severity: "high",
    title: "School feeding funding gap — ₦2.1B unfunded",
    meta: "Source: Risk register · Updated 10 Jan",
    detail:
      "The 2025 appropriation covers 68% of the home-grown school feeding programme cost at current enrollment. A ₦2.1B gap remains across 1,900 participating primary schools, concentrated in 8 LGAs.",
    mitigation:
      "Mitigation: phase LGA onboarding to match disbursement schedule; pursue UBEC matching grant and revise offtake ratios per §4.1 of the school meals policy.",
  },
  {
    id: "risk:procurement-delays",
    severity: "high",
    title: "Procurement delays in 6 LGAs",
    meta: "Source: Risk register · Updated 10 Jan",
    detail:
      "Award-to-contract cycle time exceeds 90 days in 6 of 23 LGAs, delaying procurement-led job creation under the SME set-aside scenario. e-procurement portal publication (s.31) is late in 4 of the 6.",
    mitigation:
      "Mitigation: deploy Bureau fast-track desk for reserved lots; escalate publication compliance to LGA procurement officers weekly.",
  },
  {
    id: "risk:teacher-attrition",
    severity: "moderate",
    title: "Teacher attrition in rural wards",
    meta: "Source: Risk register · Updated 09 Jan",
    detail:
      "Rural ward attrition is running at 11% annualized against a 7% planning assumption, eroding the teacher pipeline scenario's first-year gains in 14 wards.",
    mitigation:
      "Mitigation: rural posting allowance top-up and accelerated licensing for locally-recruited assistants (Teachers Registration Board s.7).",
  },
  {
    id: "risk:sme-credit",
    severity: "moderate",
    title: "SME credit uptake below forecast",
    meta: "Source: Risk register · Updated 08 Jan",
    detail:
      "Q1 SME credit facility uptake is 62% of the causal model's take-up assumption (0.29 vs 0.45), lowering projected formalization gains for the procurement scenario.",
    mitigation:
      "Mitigation: pair CAC one-stop desks with lender referral; re-run scenario with revised take-up prior before cabinet review.",
  },
];

const SEVERITY_META = {
  high: {
    label: "High",
    Icon: AlertOctagon,
    classes: "border-l-status-danger text-status-danger",
  },
  moderate: {
    label: "Moderate",
    Icon: AlertTriangle,
    classes: "border-l-status-warning text-status-warning",
  },
} as const;

export interface TopRisksProps {
  onOpenEvidence?: (risk: RiskItem) => void;
  className?: string;
}

export default function TopRisks({ onOpenEvidence, className }: TopRisksProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section
      className={cn(
        "rounded-md border border-ink-subtle bg-ink-surface p-4",
        className,
      )}
      aria-labelledby="risks-title"
    >
      <h2 id="risks-title" className="text-lg font-semibold text-ink-primary">
        Top risks
      </h2>
      <ol className="mt-3 space-y-2">
        {RISKS.map((risk, i) => {
          const meta = SEVERITY_META[risk.severity];
          const open = openId === risk.id;
          return (
            <motion.li
              key={risk.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                delay: i * 0.07,
                duration: 0.24,
                ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
              }}
              className={cn(
                "rounded-md border border-ink-subtle border-l-2 bg-ink-inset/40",
                meta.classes,
              )}
            >
              <button
                type="button"
                onClick={() => setOpenId(open ? null : risk.id)}
                aria-expanded={open}
                className="flex w-full items-start gap-2 p-3 text-left"
              >
                <meta.Icon
                  aria-hidden
                  className={cn("mt-0.5 h-4 w-4 shrink-0", meta.classes)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full border border-current px-1.5 py-px text-[10px] font-medium uppercase tracking-[0.04em]",
                        meta.classes,
                      )}
                    >
                      {meta.label}
                    </span>
                    <span className="text-sm font-medium text-ink-primary">
                      {risk.title}
                    </span>
                  </span>
                  <span className="mt-1 block font-mono text-[11px] text-ink-muted">
                    {risk.meta}
                  </span>
                </span>
                <ChevronRight
                  aria-hidden
                  className={cn(
                    "mt-1 h-4 w-4 shrink-0 text-ink-muted transition-transform duration-200",
                    open && "rotate-90",
                  )}
                />
              </button>
              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    key="detail"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="border-t border-ink-subtle px-3 py-3">
                      <p className="text-[13px] leading-5 text-ink-secondary">
                        {risk.detail}
                      </p>
                      <p className="mt-2 text-[13px] leading-5 text-ink-secondary">
                        <span className="font-medium text-status-success">
                          {risk.mitigation.split(":")[0]}:
                        </span>
                        {risk.mitigation.split(":").slice(1).join(":")}
                      </p>
                      {onOpenEvidence && (
                        <button
                          type="button"
                          onClick={() => onOpenEvidence(risk)}
                          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-civic hover:text-civic-strong"
                        >
                          <BookOpenText aria-hidden className="h-3.5 w-3.5" />
                          Evidence
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ol>
    </section>
  );
}
