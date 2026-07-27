import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Onboarding pack contract (mirrors onboarding/packs/pack.schema.json) */
/* ------------------------------------------------------------------ */

export const ADMIN_LEVELS = ["federal", "state", "lga", "ward"] as const;

export const provenanceSchema = z.object({
  origin: z.enum(["live", "derived", "seed"]),
  source_url: z.string().nullable(),
  fetched_at: z.union([z.date(), z.string()]).nullable(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

const packUnitSchema: z.ZodType<PackUnit> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    population: z.number().int().nullish(),
    children: z.array(packUnitSchema).optional(),
  }),
);
export interface PackUnit {
  id: string;
  name: string;
  population?: number | null;
  children?: PackUnit[];
}

export const packSchema = z.object({
  pack_version: z.string(),
  jurisdiction: z.object({
    id: z.string().regex(/^[a-z]{2}-[a-z0-9-]+$/),
    name: z.string().min(1),
    country_iso3: z.string().length(3),
    country_code: z.string().length(2),
    admin_level: z.enum(ADMIN_LEVELS),
    admin_levels: z.array(z.enum(ADMIN_LEVELS)).min(1),
    currency: z.string().length(3),
    languages: z.array(z.string()).min(1),
    parent_id: z.string().optional(),
  }),
  hierarchy: z.object({
    level: z.enum(["state", "lga", "ward"]),
    units: z.array(packUnitSchema),
  }),
  connectors: z.object({
    worldbank: z
      .object({
        country_iso3: z.string().length(3),
        indicators: z.array(z.string()).min(1),
        since: z.string().optional(),
      })
      .optional(),
    overpass: z
      .object({
        area_name: z.string(),
        admin_level: z.number().int().optional(),
        amenities: z
          .array(z.enum(["school", "clinic", "hospital", "marketplace"]))
          .optional(),
      })
      .optional(),
    hdx: z
      .object({
        queries: z.array(z.string()).optional(),
        download_csv: z.boolean().optional(),
      })
      .optional(),
    nada: z
      .object({
        search: z.string().optional(),
        page_size: z.number().int().optional(),
      })
      .optional(),
    budeshi: z
      .object({
        buyer_names: z.array(z.string()).optional(),
        limit: z.number().int().optional(),
      })
      .optional(),
    file_harvester: z
      .object({
        files: z.array(z.object({ url: z.string(), kind: z.string().optional() })),
      })
      .optional(),
  }),
  sectors: z
    .array(
      z.object({
        code: z.string().min(1),
        name: z.string().min(1),
        multiplier_set: z.string().min(1),
      }),
    )
    .min(1),
  seed_policy: z.object({
    allowed: z.array(
      z.enum([
        "sector_metrics",
        "opportunities",
        "evidence_sources",
        "facilities",
        "procurement_records",
      ]),
    ),
    notes: z.string().optional(),
  }),
  targets: z
    .object({
      jobs_target: z.number().int().optional(),
      horizon_months: z.number().int().optional(),
    })
    .optional(),
  branding: z
    .object({
      display_name: z.string().optional(),
      tagline: z.string().optional(),
    })
    .optional(),
});
export type OnboardingPack = z.infer<typeof packSchema>;

/* ------------------------------------------------------------------ */
/* API payloads                                                        */
/* ------------------------------------------------------------------ */

export const onboardInputSchema = z.object({
  pack_code: z.string().min(1),
  idempotency_key: z.string().min(8).optional(),
});

export interface PackSummary {
  pack_code: string;
  jurisdiction_id: string;
  name: string;
  country_iso3: string;
  currency: string;
  languages: string[];
  admin_levels: string[];
  unit_count: number;
  connectors: string[];
  display_name?: string;
}

export interface OnboardJobResult {
  job_id: string;
  pack_code: string;
  jurisdiction_id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  mode: "ingestion_service" | "local_fallback";
  connector_jobs: { connector: string; job_id: string | null; error?: string }[];
  upserts: Record<string, number>;
  error?: string | null;
}

export interface JurisdictionProvenanceSummary {
  jurisdiction_id: string;
  name: string;
  admin_level: string;
  origin: string;
  counts: {
    metrics: { live: number; derived: number; seed: number };
    facilities: { live: number; derived: number; seed: number };
    procurement: { live: number; derived: number; seed: number };
  };
  last_ingestion_at: string | null;
}
