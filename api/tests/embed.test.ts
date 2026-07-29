import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { embedCardOutput } from "@contracts/embed";
import { appRouter } from "../router";
import { __resetEmbedRateLimit } from "../embed";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";

const db = getDb();
const TEST_OPP_ID = "opp:embed-test-1";

beforeAll(async () => {
  const have = await db.query.opportunities.findFirst({
    where: eq(schema.opportunities.opportunityId, TEST_OPP_ID),
  });
  if (!have) {
    await db.insert(schema.opportunities).values({
      opportunityId: TEST_OPP_ID,
      jurisdictionId: "jur:ng",
      sectorCode: "energy",
      title: 'Solar mini-grid <script>alert("x")</script> programme',
      summary: "Embedded-card sanitization fixture.",
      evidenceRefs: ["ev:embed-test-1", "ev:embed-test-2"],
      origin: "seed",
    });
  }
  __resetEmbedRateLimit();
});

function anonCtx(): TrpcContext {
  return {
    req: new Request("http://test.local/", {
      headers: { "x-forwarded-for": "203.0.113.7" },
    }),
    resHeaders: new Headers(),
  };
}

describe("I2 — embed widgets", () => {
  it("opportunityCard returns only sanitized public fields", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.embed.opportunityCard({ opportunity_id: TEST_OPP_ID });
    const card = embedCardOutput.parse(res.data);
    expect(card.opportunity_id).toBe(TEST_OPP_ID);
    expect(card.sector).toBe("energy");
    expect(card.jurisdiction).toBe("jur:ng");
    expect(card.evidence_count).toBe(2);
    expect(card.link).toContain(encodeURIComponent(TEST_OPP_ID));
    // Sanitization: no internal fields leak.
    const keys = Object.keys(res.data as Record<string, unknown>).sort();
    expect(keys).toEqual(
      ["evidence_count", "jurisdiction", "link", "opportunity_id", "sector", "summary", "title"].sort(),
    );
  });

  it("unknown opportunity yields OPPORTUNITY_NOT_FOUND", async () => {
    const caller = appRouter.createCaller(anonCtx());
    await expect(
      caller.embed.opportunityCard({ opportunity_id: "opp:no-such" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("scriptTag returns iframe-safe HTML with escaped dynamic text", async () => {
    const caller = appRouter.createCaller(anonCtx());
    const res = await caller.embed.scriptTag({ opportunity_id: TEST_OPP_ID });
    const html = res.data.html;
    expect(html).toContain('class="meridian-opp-card"');
    expect(html).toContain("Solar mini-grid");
    // The injected <script> from the title must be escaped.
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    // Script-free snippet: no executable tags at all beyond the card markup.
    expect(html.toLowerCase()).not.toContain("onload=");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("rate limiter rejects after 60 requests/min per client", async () => {
    __resetEmbedRateLimit();
    const ctx = anonCtx();
    const caller = appRouter.createCaller(ctx);
    for (let i = 0; i < 60; i++) {
      await caller.embed.opportunityCard({ opportunity_id: TEST_OPP_ID });
    }
    await expect(
      caller.embed.opportunityCard({ opportunity_id: TEST_OPP_ID }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    __resetEmbedRateLimit();
  }, 30000);
});
