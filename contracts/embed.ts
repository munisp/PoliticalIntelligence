import { z } from "zod";

/**
 * I2 — Opportunity embed widgets (docs/EMBED.md).
 *
 * Public, sanitized card payloads for third-party sites. The card contains
 * ONLY public fields — no scores internals, review state, creator ids,
 * provenance internals or evidence payloads beyond a count.
 */

export const embedCardInput = z.object({
  opportunity_id: z.string().min(1).max(64),
});
export type EmbedCardInput = z.infer<typeof embedCardInput>;

export const embedCardOutput = z.object({
  opportunity_id: z.string(),
  title: z.string(),
  sector: z.string(),
  jurisdiction: z.string(),
  summary: z.string().nullable(),
  evidence_count: z.number().int().nonnegative(),
  /** Absolute URL of the opportunity page on this deployment. */
  link: z.string(),
});
export type EmbedCardOutput = z.infer<typeof embedCardOutput>;

export const embedScriptInput = embedCardInput.extend({
  /** Optional theme hint rendered into the iframe URL. */
  theme: z.enum(["light", "dark"]).default("dark"),
});
export type EmbedScriptInput = z.infer<typeof embedScriptInput>;

export const embedScriptOutput = z.object({
  opportunity_id: z.string(),
  /** iframe-safe HTML snippet ready to paste into a third-party page. */
  html: z.string(),
});
export type EmbedScriptOutput = z.infer<typeof embedScriptOutput>;
