import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import * as schema from "@db/schema";
import { appRouter } from "../router";
import { getDb } from "../queries/connection";
import { findDocument } from "../queries/admin";
import {
  DocumentsServiceUnreachable,
  fallbackProcess,
  runServicePipeline,
} from "../queries/documents";
import {
  clauseArtifactSchema,
  documentRegisterInput,
} from "@contracts/documents";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

/**
 * Document pipeline API tests. The documents service is simulated as
 * unreachable (fetch to its base URL rejects) so the deterministic fallback
 * path is exercised; bridge behaviour is covered against the mock.
 */

const realFetch = globalThis.fetch;

beforeEach(() => {
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("127.0.0.1:8400") || href.includes("localhost:8400")) {
      throw new TypeError("fetch failed");
    }
    return realFetch(url as string, init);
  });
});

afterEach(() => {
  vi.stubGlobal("fetch", realFetch);
});

async function demoUser(unionId: string): Promise<User> {
  const user = await getDb().query.users.findFirst({
    where: eq(schema.users.unionId, unionId),
  });
  if (!user) throw new Error(`seed user ${unionId} missing — run db/seed.ts`);
  return user;
}

function ctxFor(user: User): TrpcContext {
  return { req: new Request("http://test.local/"), resHeaders: new Headers(), user };
}

const PPA_TXT = `Public Procurement Act 2007
1. — Establishment of the Bureau.
(1) The Bureau shall maintain a register of contractors.
2. — Functions.
The Bureau may issue guidelines.
`;

describe("fallback processor (deterministic)", () => {
  it("extracts text from txt payloads with sub-threshold confidence", () => {
    const a = fallbackProcess(Buffer.from(PPA_TXT), "act.txt");
    const b = fallbackProcess(Buffer.from(PPA_TXT), "act.txt");
    expect(a).toEqual(b); // deterministic
    expect(a.processing_mode).toBe("fallback");
    expect(a.text).toContain("Public Procurement Act");
    expect(a.clause_count).toBe(2);
    expect(a.ocr_confidence).toBeLessThan(0.75); // BR-4 → review
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects binary formats (they require the OCR service)", () => {
    expect(() => fallbackProcess(Buffer.from("%PDF-1.4 ..."), "act.pdf"))
      .toThrow(/documents service/);
  });
});

describe("documents bridge", () => {
  it("maps connection failure to DocumentsServiceUnreachable", async () => {
    await expect(
      runServicePipeline({
        data: Buffer.from(PPA_TXT),
        filename: "act.txt",
        title: "PPA",
        jurisdictionId: "jur:ng-kd",
        docType: "law",
        language: "en",
        idempotencyKey: "bridge-test-0001",
      }),
    ).rejects.toBeInstanceOf(DocumentsServiceUnreachable);
  });
});

describe("contracts", () => {
  it("register input validates base64 size guard and idempotency key", () => {
    expect(() =>
      documentRegisterInput.parse({
        title: "x".repeat(3),
        jurisdiction_id: "jur:ng-kd",
        idempotency_key: "short",
      }),
    ).toThrow();
    const ok = documentRegisterInput.parse({
      title: "Valid title",
      jurisdiction_id: "jur:ng-kd",
      content_base64: Buffer.from("hello").toString("base64"),
      idempotency_key: "valid-key-0001",
    });
    expect(ok.language).toBe("en");
  });

  it("clause artifact schema matches the service output shape", () => {
    const clause = clauseArtifactSchema.parse({
      clause_id: "clause:1",
      section_path: "s.1",
      text: "The Bureau shall maintain a register.",
      kind: "section",
      confidence: 0.95,
      obligations: [
        { kind: "obligation", action: "shall maintain", modal: "shall" },
      ],
      defined_terms: [],
      citations: [],
    });
    expect(clause.obligations[0].kind).toBe("obligation");
  });
});

describe("documents.register (service unreachable → fallback)", () => {
  it("registers via fallback, flags processing_mode and review state", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    const res = await caller.documents.register({
      title: `Fallback Act ${nanoid(4)}`,
      jurisdiction_id: "jur:ng-kd",
      doc_type: "law",
      filename: "act.txt",
      content_base64: Buffer.from(PPA_TXT).toString("base64"),
      idempotency_key: `reg-${nanoid(12)}`,
    });
    const data = res.data as {
      document_id: string;
      status: string;
      processing_mode: string;
      ocr_confidence: number;
      review_state: string;
    };
    expect(data.status).toBe("fallback");
    expect(data.processing_mode).toBe("fallback");
    expect(data.review_state).toBe("in_review");
    const row = await findDocument(data.document_id);
    expect(row).toBeTruthy();
    expect(row!.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.ocrConfidence).toBeLessThan(0.75);
    expect(row!.reviewState).toBe("in_review");
  });

  it("rejects oversized binary payloads", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    await expect(
      caller.documents.register({
        title: "Oversized upload",
        jurisdiction_id: "jur:ng-kd",
        filename: "big.txt",
        content_base64: Buffer.alloc(11 * 1024 * 1024, 65).toString("base64"),
        idempotency_key: `big-${nanoid(12)}`,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("processingStatus surfaces a retryable error when service is down", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    await expect(
      caller.documents.processingStatus({ job_id: "docjob_missing" }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});

describe("legislation.importFromDocument", () => {
  it("requires legal_analyst/data_steward role", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const caller = appRouter.createCaller(ctxFor(analyst));
    await expect(
      caller.legislation.importFromDocument({ document_id: "doc:anything" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects non-law documents", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const steward: User = { ...analyst, id: 999002, platformRole: "platform_admin" };
    const caller = appRouter.createCaller(ctxFor(steward));
    const reg = await caller.documents.register({
      title: `Report ${nanoid(4)}`,
      jurisdiction_id: "jur:ng-kd",
      doc_type: "report",
      filename: "r.txt",
      content_base64: Buffer.from(PPA_TXT).toString("base64"),
      idempotency_key: `rep-${nanoid(12)}`,
    });
    const documentId = (reg.data as { document_id: string }).document_id;
    await expect(
      caller.legislation.importFromDocument({ document_id: documentId }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("surfaces retryable error for law docs when service is down", async () => {
    const analyst = await demoUser("demo-policy-analyst");
    const steward: User = { ...analyst, id: 999003, platformRole: "platform_admin" };
    const caller = appRouter.createCaller(ctxFor(steward));
    const reg = await caller.documents.register({
      title: `Law Import ${nanoid(4)}`,
      jurisdiction_id: "jur:ng-kd",
      doc_type: "law",
      filename: "law.txt",
      content_base64: Buffer.from(PPA_TXT).toString("base64"),
      idempotency_key: `law-${nanoid(12)}`,
    });
    const documentId = (reg.data as { document_id: string }).document_id;
    await expect(
      caller.legislation.importFromDocument({ document_id: documentId }),
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });
});
