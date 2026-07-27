/**
 * Typed client wrappers for the innovation/onboarding tRPC contracts.
 *
 * These procedures are being built on a parallel backend branch and are NOT
 * present in the AppRouter type this branch compiles against. We therefore
 * use a loosely-typed vanilla tRPC client plus typed wrapper functions, and
 * degrade gracefully (return null / throw a typed error) when a procedure is
 * missing on the deployed API — pages render their designed empty states.
 *
 * All procedures return the standard envelope; unwrap() handles both shapes.
 */
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import superjson from "superjson";
import { unwrap } from "@/lib/trpc-data";

/* ------------------------------------------------------------------ */
/* Contract types (guaranteed by spec)                                 */
/* ------------------------------------------------------------------ */

export type ProvenanceOrigin = "live" | "derived" | "seed";

export interface ProvenanceInfo {
  origin: ProvenanceOrigin;
  source_url?: string | null;
  fetched_at?: string | Date | null;
}

export interface OnboardingPackSummary {
  pack_code: string;
  name: string;
  country_iso3: string;
  admin_levels: string[];
  live_connectors: string[];
  status: string;
}

export interface OnboardingPackDetail extends OnboardingPackSummary {
  hierarchy?: { level: string; name: string; children?: unknown[] }[];
  seed_policy?: { notes?: string; seeded_datasets?: string[] };
  [key: string]: unknown;
}

export interface OnboardJobStatus {
  status: "queued" | "running" | "succeeded" | "failed" | string;
  progress?: number | null;
  log: string[];
  result?: { jurisdiction_id: string; counts?: Record<string, number> } | null;
}

export interface JurisdictionProvenanceSummary {
  jurisdiction_id: string;
  name: string;
  provenance: { live: number; derived: number; seed: number };
}

export interface ScoreDecomposition {
  total: number;
  parts: { feature: string; contribution: number }[];
}

export interface OptimizePortfolioInput {
  jurisdiction_id: string;
  budget_ngn: number;
  intervention_ids: string[];
  constraints?: Record<string, unknown>;
}

export interface OptimizePortfolioResult {
  selected: {
    intervention_id: string;
    title: string;
    cost_ngn: number;
    expected_jobs: number;
  }[];
  total_cost: number;
  total_jobs: number;
  binding_constraints: string[];
}

export interface MarketplaceTemplate {
  template_id: string;
  name: string;
  description: string;
  author_jurisdiction: string;
  installs: number;
  rating: number;
  published_state: string;
}

export interface ParsedScenarioConfig {
  name: string;
  sector_code?: string;
  interventions: string[];
  budget_ngn?: number;
  horizon_months?: number;
  models: string[];
}

export interface ParseScenarioResult {
  config: ParsedScenarioConfig;
  field_confidence: Record<string, number>;
  needs_review: string[];
}

export interface TrustScore {
  score: number;
  components: {
    authority: number;
    freshness: number;
    corroboration: number;
    extraction: number;
  };
}

export interface AuditChainVerification {
  valid: boolean;
  entries: number;
  first_broken_id?: string | null;
}

export interface FieldDataSubmission {
  submission_id: string;
  form: string;
  payload: Record<string, unknown>;
  submitted_by: string;
  origin: ProvenanceOrigin;
  created_at: string | Date;
}

/* ------------------------------------------------------------------ */
/* Loose vanilla client (procedures typed on the other branch)         */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */
type LooseRouter = any;

export const innovationsRpc = createTRPCClient<LooseRouter>({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

/** True when the backend simply does not have this procedure yet. */
export function isProcedureMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("NOT_FOUND") ||
    msg.includes("No \"query\"") ||
    msg.includes("No \"mutation\"") ||
    msg.includes("procedure") && msg.includes("not found")
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const rpc = innovationsRpc as unknown as Record<
  string,
  Record<string, { query: (i?: any) => Promise<any>; mutate: (i?: any) => Promise<any> }>
>;

async function callQuery<T>(path: string, input?: unknown): Promise<T> {
  const [router, proc] = splitPath(path);
  const payload = await rpc[router][proc].query(input);
  return unwrap<T>(payload);
}

async function callMutation<T>(path: string, input?: unknown): Promise<T> {
  const [router, proc] = splitPath(path);
  const payload = await rpc[router][proc].mutate(input);
  return unwrap<T>(payload);
}

function splitPath(path: string): [string, string] {
  const i = path.indexOf(".");
  return [path.slice(0, i), path.slice(i + 1)];
}

/* ------------------------------------------------------------------ */
/* Generic hook factories                                              */
/* ------------------------------------------------------------------ */

type QOpts<T> = Omit<UseQueryOptions<T, Error>, "queryKey" | "queryFn">;

function useInnovationQuery<T>(
  key: readonly unknown[],
  path: string,
  input: unknown,
  opts?: QOpts<T>,
) {
  return useQuery<T, Error>({
    queryKey: key,
    queryFn: () => callQuery<T>(path, input),
    retry: (count, err) => (isProcedureMissing(err) ? false : count < 2),
    ...opts,
  });
}

type MOpts<T, V> = Omit<UseMutationOptions<T, Error, V>, "mutationFn">;

function useInnovationMutation<T, V>(path: string, opts?: MOpts<T, V>) {
  return useMutation<T, Error, V>({
    mutationFn: (vars) => callMutation<T>(path, vars),
    ...opts,
  });
}

/* ------------------------------------------------------------------ */
/* Onboarding                                                          */
/* ------------------------------------------------------------------ */

export function useOnboardingPacks(opts?: QOpts<OnboardingPackSummary[]>) {
  return useInnovationQuery<OnboardingPackSummary[]>(
    ["onboarding", "packs"],
    "onboarding.listPacks",
    undefined,
    opts,
  );
}

export function useOnboardingPack(code: string | null, opts?: QOpts<OnboardingPackDetail>) {
  return useInnovationQuery<OnboardingPackDetail>(
    ["onboarding", "pack", code],
    "onboarding.getPack",
    { code },
    { enabled: !!code, ...opts },
  );
}

export function useOnboardMutation(opts?: MOpts<{ job_id: string }, { pack_code: string; idempotency_key: string }>) {
  return useInnovationMutation<{ job_id: string }, { pack_code: string; idempotency_key: string }>(
    "onboarding.onboard",
    opts,
  );
}

export function useOnboardingStatus(jobId: string | null, opts?: QOpts<OnboardJobStatus>) {
  return useInnovationQuery<OnboardJobStatus>(
    ["onboarding", "status", jobId],
    "onboarding.status",
    { job_id: jobId },
    {
      enabled: !!jobId,
      refetchInterval: (q) => {
        const s = q.state.data?.status;
        return s === "succeeded" || s === "failed" ? false : 1500;
      },
      ...opts,
    },
  );
}

export function useOnboardingJurisdictions(opts?: QOpts<JurisdictionProvenanceSummary[]>) {
  return useInnovationQuery<JurisdictionProvenanceSummary[]>(
    ["onboarding", "jurisdictions"],
    "onboarding.jurisdictions",
    undefined,
    opts,
  );
}

/* ------------------------------------------------------------------ */
/* Innovations                                                         */
/* ------------------------------------------------------------------ */

export function useScoreDecomposition(opportunityId: string | null) {
  return useInnovationQuery<ScoreDecomposition>(
    ["innovations", "scoreDecomposition", opportunityId],
    "innovations.scoreDecomposition",
    { opportunity_id: opportunityId },
    { enabled: !!opportunityId },
  );
}

export function useOptimizePortfolio(
  opts?: MOpts<OptimizePortfolioResult, OptimizePortfolioInput>,
) {
  return useInnovationMutation<OptimizePortfolioResult, OptimizePortfolioInput>(
    "innovations.optimizePortfolio",
    opts,
  );
}

export function useMarketplaceList(opts?: QOpts<MarketplaceTemplate[]>) {
  return useInnovationQuery<MarketplaceTemplate[]>(
    ["innovations", "marketplace"],
    "innovations.marketplace.list",
    undefined,
    opts,
  );
}

export function useMarketplaceInstall(
  opts?: MOpts<{ scenario_id: string }, { template_id: string; jurisdiction_id: string }>,
) {
  return useInnovationMutation<
    { scenario_id: string },
    { template_id: string; jurisdiction_id: string }
  >("innovations.marketplace.install", opts);
}

export function useMarketplacePublish(
  opts?: MOpts<unknown, { scenario_id: string; name: string; description: string }>,
) {
  return useInnovationMutation<
    unknown,
    { scenario_id: string; name: string; description: string }
  >("innovations.marketplace.publish", opts);
}

export function useParseScenarioText(
  opts?: MOpts<ParseScenarioResult, { text: string; jurisdiction_id: string }>,
) {
  return useInnovationMutation<ParseScenarioResult, { text: string; jurisdiction_id: string }>(
    "innovations.parseScenarioText",
    opts,
  );
}

export function useTrustScore(evidenceSourceId: string | null) {
  return useInnovationQuery<TrustScore>(
    ["innovations", "trustScore", evidenceSourceId],
    "innovations.trustScore",
    { evidence_source_id: evidenceSourceId },
    { enabled: !!evidenceSourceId },
  );
}

export function useVerifyAuditChain(opts?: QOpts<AuditChainVerification>) {
  return useInnovationQuery<AuditChainVerification>(
    ["innovations", "verifyAuditChain"],
    "innovations.verifyAuditChain",
    undefined,
    opts,
  );
}

export function useFieldDataList(jurisdictionId: string | null) {
  return useInnovationQuery<FieldDataSubmission[]>(
    ["innovations", "fieldData", jurisdictionId],
    "innovations.fieldData.list",
    { jurisdiction_id: jurisdictionId },
    { enabled: !!jurisdictionId },
  );
}

export interface FieldDataSubmitInput {
  jurisdiction_id: string;
  form: string;
  payload: Record<string, unknown>;
  offline_id?: string;
}

export function useFieldDataSubmit(
  opts?: MOpts<{ submission_id: string; deduped: boolean }, FieldDataSubmitInput>,
) {
  const qc = useQueryClient();
  return useInnovationMutation<
    { submission_id: string; deduped: boolean },
    FieldDataSubmitInput
  >("innovations.fieldData.submit", {
    onSuccess: (data, vars, ctx, m) => {
      void qc.invalidateQueries({ queryKey: ["innovations", "fieldData"] });
      opts?.onSuccess?.(data, vars, ctx, m);
    },
    ...opts,
  });
}
