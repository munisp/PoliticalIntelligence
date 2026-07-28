import { describe, expect, it } from "vitest";
import { nanoid } from "nanoid";
import {
  escapeHtml,
  renderBrief,
  renderBriefDoc,
  renderBriefHtml,
  type RenderableBrief,
} from "../utils/render";
import { insertBrief } from "../queries/briefs";
import { listExportEvents } from "../queries/audit";
import { draftBriefSections, templateBriefSections } from "../bridges/ai";
import { appRouter } from "../router";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

const sampleBrief: RenderableBrief = {
  briefId: "brf:ng-kd:test1234",
  jurisdictionId: "jur:ng-kd",
  title: "Healthcare Investment Brief",
  reviewState: "in_review",
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-02T00:00:00Z"),
  signedOffAt: null,
  content: {
    title: "Healthcare Investment Brief <draft>",
    sections: [
      { heading: "Executive summary", body: "Summary body & details." },
      { heading: "Situation", body: "Situation body." },
      { heading: "Recommendation", body: "Recommendation body." },
    ],
    citations_rail: [
      { evidence_source_id: "ev:1", citation: "Budget speech 2024" },
      { evidence_source_id: "ev:2", citation: "M&E report Q3" },
      { evidence_source_id: "ev:3", citation: "Facility survey" },
    ],
  },
  modelRouting: {
    tier: "remote",
    model: "serving-tier",
    fallback: false,
    run_manifest_hash: "abc123def456",
  },
};

/* ------------------------------------------------------------------ */
/* Renderer structure                                                  */
/* ------------------------------------------------------------------ */
describe("brief renderer", () => {
  it("escapes HTML entities", () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&amp;&#39;",
    );
  });

  it("renders standalone HTML with all required sections", () => {
    const html = renderBriefHtml(sampleBrief, { requestId: "req_test_1" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<style>"); // inline CSS
    expect(html).toContain("@media print"); // print-optimized
    // title block, jurisdiction, generated-at
    expect(html).toContain("Healthcare Investment Brief &lt;draft&gt;");
    expect(html).toContain("jur:ng-kd");
    expect(html).toContain("2025-01-02");
    // executive summary + sections
    expect(html).toContain("exec-summary");
    expect(html).toContain("Summary body &amp; details.");
    expect(html).toContain("Situation body.");
  });

  it("numbers citations and links markers to rail anchors", () => {
    const html = renderBriefHtml(sampleBrief, { requestId: "req_test_2" });
    expect(html).toContain('id="citation-1"');
    expect(html).toContain('id="citation-3"');
    expect(html).toContain('href="#citation-1"');
    expect(html.indexOf("[1]")).toBeLessThan(html.indexOf('id="citation-1"'));
    expect(html).toContain("Budget speech 2024");
    expect(html).toContain("ev:3");
  });

  it("stamps provenance footer with origin, manifest hash, request_id", () => {
    const html = renderBriefHtml(sampleBrief, { requestId: "req_test_3" });
    const footer = html.slice(html.indexOf('class="provenance"'));
    expect(footer).toContain("serving tier remote");
    expect(footer).toContain("Run manifest: abc123def456");
    expect(footer).toContain("Audit request_id: req_test_3");
    expect(footer).toContain("in_review");
  });

  it("marks template-assembled provenance when routing fell back", () => {
    const html = renderBriefHtml(
      {
        ...sampleBrief,
        modelRouting: { tier: "offline-fallback", model: "deterministic", fallback: true },
      },
      { requestId: "req_test_4" },
    );
    expect(html).toContain("template-assembled (offline tier)");
    expect(html).not.toContain("Run manifest:");
  });

  it("renders Word-compatible .doc with MIME preamble", () => {
    const doc = renderBriefDoc(sampleBrief, { requestId: "req_test_5" });
    expect(doc.startsWith("MIME-Version: 1.0")).toBe(true);
    expect(doc).toContain("schemas-microsoft-com:office:word");
    expect(doc).toContain("Executive summary");
  });

  it("renderBrief returns filename + mime per format", () => {
    const html = renderBrief(sampleBrief, "html", { requestId: null });
    expect(html.filename).toBe("brief-brf-ng-kd-test1234.html");
    expect(html.mimeType).toBe("text/html");
    const doc = renderBrief(sampleBrief, "doc", { requestId: null });
    expect(doc.filename).toBe("brief-brf-ng-kd-test1234.doc");
    expect(doc.mimeType).toBe("application/msword");
  });
});

/* ------------------------------------------------------------------ */
/* Section drafting: mocked serving client + offline fallback           */
/* ------------------------------------------------------------------ */
describe("draftBriefSections", () => {
  const evidence = [
    { evidence_source_id: "ev:1", source_type: "document" as const, citation: "C", confidence: 0.9 },
  ];

  it("uses serving-tier bodies when the remote tier responds", async () => {
    const out = await draftBriefSections({
      title: "T",
      template: "executive_memo",
      jurisdiction_id: "jur:ng-kd",
      evidence,
      queryFn: async ({ query }) => ({
        answer: `Drafted: ${query.slice(0, 24)}`,
        citations: [],
        confidence: 0.8,
        bridge: "remote" as const,
      }),
    });
    expect(out.bridge).toBe("remote");
    expect(out.routing.tier).toBe("remote");
    expect(out.routing.fallback).toBe(false);
    expect(out.sections.map((s) => s.heading)).toEqual([
      "Executive summary",
      "Situation",
      "Options",
      "Recommendation",
    ]);
    expect(out.sections[0].body).toContain("Drafted:");
  });

  it("falls back to template when the offline tier responds", async () => {
    const out = await draftBriefSections({
      title: "T",
      template: "executive_memo",
      jurisdiction_id: "jur:ng-kd",
      evidence,
      queryFn: async () => ({
        answer: "offline answer",
        citations: [],
        confidence: 0.4,
        bridge: "fallback" as const,
      }),
    });
    expect(out.bridge).toBe("fallback");
    expect(out.routing.tier).toBe("offline-fallback");
    expect(out.sections).toEqual(templateBriefSections());
  });

  it("falls back to template when the serving client throws", async () => {
    const out = await draftBriefSections({
      title: "T",
      template: "executive_memo",
      jurisdiction_id: "jur:ng-kd",
      evidence,
      queryFn: async () => {
        throw new Error("connection refused");
      },
    });
    expect(out.bridge).toBe("fallback");
    expect(out.sections).toEqual(templateBriefSections());
  });

  it("is deterministic against the real client with no service running", async () => {
    const out = await draftBriefSections({
      title: "T",
      template: "executive_memo",
      jurisdiction_id: "jur:ng-kd",
      evidence,
    });
    expect(out.bridge).toBe("fallback");
    expect(out.sections).toEqual(templateBriefSections());
  }, 30_000);
});

/* ------------------------------------------------------------------ */
/* exportRendered procedure: auth + audit                              */
/* ------------------------------------------------------------------ */
function ctxFor(platformRole: string | null): TrpcContext {
  if (platformRole === null) {
    return { req: new Request("http://test.local/"), resHeaders: new Headers() };
  }
  const user = {
    id: 999020,
    unionId: `render-${platformRole}`,
    name: "Render Tester",
    email: null,
    avatar: null,
    role: "user",
    platformRole,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignInAt: new Date(),
  } as User;
  return { req: new Request("http://test.local/"), resHeaders: new Headers(), user };
}

/** Seeded analyst with jur:ng-kd read grant (db/seed.ts). */
async function analystCtx(): Promise<TrpcContext> {
  const { getDb } = await import("../queries/connection");
  const schema = await import("@db/schema");
  const { eq } = await import("drizzle-orm");
  const user = await getDb().query.users.findFirst({
    where: eq(schema.users.unionId, "demo-policy-analyst"),
  });
  if (!user) throw new Error("seed user missing — run db/seed.ts");
  return { req: new Request("http://test.local/"), resHeaders: new Headers(), user };
}

describe("briefs.exportRendered", () => {
  async function seedBrief() {
    const briefId = `brf:ng-kd:render-${nanoid(6)}`;
    await insertBrief({
      briefId,
      jurisdictionId: "jur:ng-kd",
      template: "executive_memo",
      title: "Rendered export test brief",
      reviewState: "in_review",
      content: sampleBrief.content,
      modelRouting: sampleBrief.modelRouting,
      requestId: "req_seed_render",
      createdBy: null,
    });
    return briefId;
  }

  it("rejects unauthenticated callers", async () => {
    const caller = appRouter.createCaller(ctxFor(null));
    await expect(
      caller.briefs.exportRendered({ brief_id: "brf:x", format: "html" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects roles outside policy_analyst/executive", async () => {
    const caller = appRouter.createCaller(ctxFor("viewer"));
    await expect(
      caller.briefs.exportRendered({ brief_id: "brf:x", format: "html" }),
    ).rejects.toThrow();
  });

  it("renders HTML for an analyst and records the export in the audit chain", async () => {
    const briefId = await seedBrief();
    const caller = appRouter.createCaller(await analystCtx());
    const payload = (await caller.briefs.exportRendered({
      brief_id: briefId,
      format: "html",
    })) as { data: { filename: string; mime_type: string; content: string; request_id: string } };
    expect(payload.data.filename).toContain(briefId.replace(/[^A-Za-z0-9]+/g, "-"));
    expect(payload.data.mime_type).toBe("text/html");
    expect(payload.data.content).toContain("Healthcare Investment Brief");
    expect(payload.data.content).toContain(payload.data.request_id);

    const events = await listExportEvents("brief", briefId);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const latest = events[0];
    expect(latest.action).toBe("briefs.exported");
    const data = (latest.payload as { data?: Record<string, unknown> }).data!;
    expect(data.format).toBe("html");
    expect(data.rendered).toBe(true);
    expect(data.filename).toBe(payload.data.filename);
    expect(latest.requestId).toBe(payload.data.request_id);
  }, 30_000);

  it("renders Word .doc for an executive", async () => {
    const briefId = await seedBrief();
    const caller = appRouter.createCaller(ctxFor("executive"));
    const payload = (await caller.briefs.exportRendered({
      brief_id: briefId,
      format: "doc",
    })) as { data: { filename: string; mime_type: string; content: string } };
    expect(payload.data.filename.endsWith(".doc")).toBe(true);
    expect(payload.data.mime_type).toBe("application/msword");
    expect(payload.data.content.startsWith("MIME-Version: 1.0")).toBe(true);
  }, 30_000);

  it("404s on an unknown brief", async () => {
    const caller = appRouter.createCaller(await analystCtx());
    await expect(
      caller.briefs.exportRendered({ brief_id: "brf:nope", format: "html" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
