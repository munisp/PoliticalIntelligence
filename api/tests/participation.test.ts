import { describe, expect, it, beforeAll } from "vitest";
import { aggregateThemes, tagThemes } from "@contracts/participation";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import { anonCtx, ctxFor, ensureUser } from "./helpers";

let lawId: string;

beforeAll(async () => {
  const db = getDb();
  const laws = await db.query.laws.findMany({ limit: 1 });
  if (!laws.length) throw new Error("no laws seeded — run db/seed.ts");
  lawId = laws[0].lawId;
});

describe("participation theme engine (pure)", () => {
  it("tagThemes buckets keywords deterministically", () => {
    expect(tagThemes("This tax on small business will kill jobs")).toEqual(
      expect.arrayContaining(["taxation_revenue", "business_msme", "employment_jobs"]),
    );
    expect(tagThemes("unrelated prose")).toEqual([]);
    // determinism
    expect(tagThemes("Land titles and C of O")).toEqual(tagThemes("land titles and C of O"));
  });

  it("aggregateThemes counts per theme with sentiment split, deterministic order", () => {
    const out = aggregateThemes([
      { body: "support this tax", sentimentHint: "support" },
      { body: "oppose the tax on jobs", sentimentHint: "oppose" },
      { body: "no theme here", sentimentHint: "neutral" },
    ]);
    const tax = out.find((t) => t.theme === "taxation_revenue");
    expect(tax).toMatchObject({ total: 2, support: 1, oppose: 1 });
    expect(out.find((t) => t.theme === "other")).toMatchObject({ total: 1, neutral: 1 });
    // stable sort: totals desc
    for (let i = 1; i < out.length; i++) expect(out[i - 1].total).toBeGreaterThanOrEqual(out[i].total);
  });
});

describe("participation router", () => {
  it("anonymous comment is PII-redacted and stored with theme tags", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.participation.comment({
      law_id: lawId,
      body: "Great bill, call me on 08034567890 to discuss the tax on jobs",
      sentiment_hint: "support",
      pseudonym: "Concerned Trader",
    });
    expect(res.data.status).toBe("visible");
    expect(res.data.body).toContain("[REDACTED:phone]");
    expect(res.data.body).not.toContain("08034567890");
    expect(res.data.themeTags).toEqual(
      expect.arrayContaining(["taxation_revenue", "employment_jobs"]),
    );
  });

  it("themes endpoint aggregates only visible comments", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const t = await caller.participation.themes({ law_id: lawId });
    expect(t.data.total_comments).toBeGreaterThanOrEqual(1);
    expect(t.data.themes.length).toBeGreaterThanOrEqual(1);
    expect(t.data.themes[0]).toHaveProperty("total");
    expect(t.data.themes[0]).toHaveProperty("support");
  });

  it("moderation is role-gated; data_steward can hide, then list excludes hidden", async () => {
    const steward = await ensureUser("demo-data-steward", "data_steward", "Demo Data Steward");
    const analyst = await ensureUser("demo-policy-analyst", "policy_analyst");
    const anon = appRouter.createCaller(anonCtx());
    const c = await anon.participation.comment({
      law_id: lawId,
      body: "spammy procurement tender comment",
      sentiment_hint: "neutral",
      pseudonym: "Mod Target",
    });
    await expect(
      appRouter.createCaller(ctxFor(analyst)).participation.moderate({
        comment_id: c.data.commentId,
        status: "hidden",
      }),
    ).rejects.toThrow();
    const mod = await appRouter
      .createCaller(ctxFor(steward))
      .participation.moderate({ comment_id: c.data.commentId, status: "hidden", reason: "spam" });
    expect(mod.data.status).toBe("hidden");
    const list = await anon.participation.list({ law_id: lawId });
    const found = list.data.find((x) => x.comment_id === c.data.commentId);
    expect(found).toBeUndefined();
  });

  it("rate limiter blocks floods from one actor", async () => {
    const caller = appRouter.createCaller(anonCtx()); // same anon key
    // Re-resolve a live law id (shared dev DB — rows can be pruned).
    const laws = await getDb().query.laws.findMany({ limit: 1 });
    const liveLawId = laws[0]?.lawId ?? lawId;
    let blocked = false;
    for (let i = 0; i < 12; i++) {
      try {
        await caller.participation.comment({
          law_id: liveLawId,
          body: `flood comment ${i}`,
          sentiment_hint: "neutral",
          pseudonym: "Flooder",
        });
      } catch (err) {
        if (/rate limit/i.test(String(err))) {
          blocked = true;
          break;
        }
        throw err;
      }
    }
    expect(blocked).toBe(true);
  });
});
