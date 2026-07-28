import { createRouter, publicQuery } from "../middleware";
import { authRouter } from "../auth-router";
import { jurisdictionsRouter } from "../jurisdictions";
import { sectorsRouter } from "../sectors";
import { opportunitiesRouter } from "../opportunities";
import { scenariosRouter } from "../scenarios";
import { legislationRouter } from "../legislation";
import { documentsRouter } from "../documents";
import { searchRouter } from "../search";
import { briefsRouter } from "../briefs";
import { adminRouter } from "../admin";
import { opsRouter } from "../ops";
import { innovationsRouter } from "../innovations";
import { auditLogRouter } from "../audit-log";
import { onboardingRouter } from "../onboarding";
import { geoRouter } from "../geo";
import {
  mountAdminRest,
  mountBriefsRest,
  mountDocumentsGatewayRest,
  mountJurisdictionsRest,
  mountLegislationRest,
  mountOpportunitiesRest,
  mountOpsRest,
  mountScenariosRest,
  type RestMount,
} from "./rest-domains";

/**
 * API-9 (spec §14): service decomposition registry.
 *
 * Maps each independently deployable domain service to:
 *   - its port (30xx; the gateway stays on 3000),
 *   - the tRPC sub-routers it serves (same router modules as the monolith —
 *     zero logic duplication),
 *   - the REST /v1 route mount for its domain.
 *
 * The 8 domain services here are the independently deployable units of the
 * §14 decomposition; the remaining spec services are already separate
 * deployables (simulation, ai, ingestion, documents) or in-process workers
 * (consumers, outbox relay, scheduler) documented in docs/ARCHITECTURE.md
 * "Deployment modes".
 */

export const DOMAIN_NAMES = [
  "jurisdictions",
  "opportunities",
  "scenarios",
  "legislation",
  "documents-gateway",
  "briefs",
  "admin",
  "ops",
] as const;

export type DomainName = (typeof DOMAIN_NAMES)[number];

export interface DomainSpec {
  name: DomainName;
  port: number;
  /** env var overriding the service URL used by the gateway in micro mode */
  urlEnv: string;
  /** top-level tRPC router keys served by this domain */
  trpcKeys: string[];
  restMount: RestMount;
  buildTrpcRouter: () => ReturnType<typeof createRouter>;
}

const ping = publicQuery.query(() => ({ ok: true, ts: Date.now() }));

function defineDomain(
  name: DomainName,
  port: number,
  routers: Record<string, unknown>,
  restMount: RestMount,
): DomainSpec {
  return {
    name,
    port,
    urlEnv: `SERVICE_URL_${name.toUpperCase().replace(/-/g, "_")}`,
    trpcKeys: Object.keys(routers),
    restMount,
    buildTrpcRouter: () => createRouter({ ping, ...routers } as never),
  };
}

export const DOMAIN_REGISTRY: Record<DomainName, DomainSpec> = {
  jurisdictions: defineDomain("jurisdictions", 3001, {
    jurisdictions: jurisdictionsRouter,
    sectors: sectorsRouter,
    geo: geoRouter,
  }, mountJurisdictionsRest),
  opportunities: defineDomain("opportunities", 3002, {
    opportunities: opportunitiesRouter,
    innovations: innovationsRouter,
    search: searchRouter,
  }, mountOpportunitiesRest),
  scenarios: defineDomain("scenarios", 3003, {
    scenarios: scenariosRouter,
  }, mountScenariosRest),
  legislation: defineDomain("legislation", 3004, {
    legislation: legislationRouter,
  }, mountLegislationRest),
  "documents-gateway": defineDomain("documents-gateway", 3005, {
    documents: documentsRouter,
  }, mountDocumentsGatewayRest),
  briefs: defineDomain("briefs", 3006, {
    briefs: briefsRouter,
  }, mountBriefsRest),
  admin: defineDomain("admin", 3007, {
    auth: authRouter,
    admin: adminRouter,
    auditLog: auditLogRouter,
    onboarding: onboardingRouter,
  }, mountAdminRest),
  ops: defineDomain("ops", 3008, {
    ops: opsRouter,
  }, mountOpsRest),
};

export function getDomain(name: string): DomainSpec {
  const spec = DOMAIN_REGISTRY[name as DomainName];
  if (!spec) {
    throw new Error(
      `unknown domain "${name}" — expected one of: ${DOMAIN_NAMES.join(", ")}`,
    );
  }
  return spec;
}

/** Map a REST /v1 path to its owning domain (gateway micro-mode routing). */
const REST_PREFIX_RULES: Array<[prefix: string, domain: DomainName]> = [
  ["/v1/jurisdictions", "jurisdictions"],
  ["/v1/sectors", "jurisdictions"],
  ["/v1/opportunities", "opportunities"],
  ["/v1/jobs", "opportunities"],
  ["/v1/search", "opportunities"],
  ["/v1/scenarios", "scenarios"],
  ["/v1/scenario-runs", "scenarios"],
  ["/v1/legislation", "legislation"],
  ["/v1/briefs", "briefs"],
  ["/v1/auth", "admin"],
  ["/v1/health", "ops"],
];

export function domainForRestPath(path: string): DomainName | null {
  for (const [prefix, domain] of REST_PREFIX_RULES) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return domain;
  }
  return null;
}

/** Map a tRPC path (/api/trpc/<routerKey>.<proc>) to its owning domain. */
export function domainForTrpcPath(path: string): DomainName | null {
  const m = path.match(/^\/api\/trpc\/([A-Za-z]+)(?:[./?]|$)/);
  if (!m) return null;
  const key = m[1]!;
  if (key === "ping") return "ops";
  for (const spec of Object.values(DOMAIN_REGISTRY)) {
    if (spec.trpcKeys.includes(key)) return spec.name;
  }
  return null;
}

/** Resolve the base URL of a domain service (micro mode). */
export function domainServiceUrl(spec: DomainSpec): string {
  return (
    process.env[spec.urlEnv] ?? `http://localhost:${spec.port}`
  ).replace(/\/$/, "");
}
