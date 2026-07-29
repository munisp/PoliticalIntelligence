import { z } from "zod";

/** I9 — Scenario marketplace contracts. */

export const PublishInput = z.object({
  simulation_run_id: z.string().min(1).max(64),
  title: z.string().min(3).max(255),
  summary: z.string().max(4000).optional(),
});

export const ForkInput = z.object({
  published_id: z.string().min(1).max(96),
  jurisdiction_id: z.string().min(1).max(64),
  name: z.string().min(3).max(255).optional(),
});

export const VerifyInput = z.object({
  published_id: z.string().min(1).max(96),
});

export const ListInput = z.object({
  limit: z.number().int().min(1).max(100).default(25),
});

export type VerificationBadge = "valid" | "stale";
