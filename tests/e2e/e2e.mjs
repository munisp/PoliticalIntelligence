#!/usr/bin/env node
/**
 * Zero-dependency E2E API suite — runs against a live server (BASE_URL) with
 * the seeded Nigeria pilot data. Covers the golden flows from docs/TESTING.md:
 *
 *   health, /v1/jurisdictions list + profile envelope, opportunity generate
 *   idempotency, scenario run lifecycle with uncertainty bands, brief
 *   generate → citations → approve → signOff RBAC matrix, audit chain verify,
 *   /metrics required series, REST error envelope on 404/403.
 *
 * Auth: mints dev session cookies itself from APP_SECRET (env or .env) for
 * the users created by `npx tsx tests/e2e/seed-users.ts`. Without a secret,
 * authenticated groups are reported as SKIP (exit still gated on what ran).
 *
 * Usage:
 *   BASE_URL=http://localhost:3000 node tests/e2e/e2e.mjs
 *
 * Exit code: 0 = pass, 1 = at least one failure.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const JUR = process.env.JURISDICTION_ID || "jur:ng-kd";

/* ------------------------------------------------------------------ */
/* tiny harness                                                        */
/* ------------------------------------------------------------------ */
let passed = 0;
let failed = 0;
let skipped = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed += 1;
      console.log(`  ok   ${name}`);
    })
    .catch((err) => {
      if (err && err.skip) {
        skipped += 1;
        console.log(`  skip ${name} — ${err.message}`);
      } else {
        failed += 1;
        console.error(`  FAIL ${name}\n       ${err.message}`);
      }
    });
}
const skip = (reason) => {
  const e = new Error(reason);
  e.skip = true;
  return e;
};
function assert(cond, msg) {
  if (!cond) throw new Error(`assertion failed: ${msg}`);
}
function group(title) {
  console.log(`\n${title}`);
}

/* ------------------------------------------------------------------ */
/* auth: mint kimi_sid cookies (HS256, same scheme as api/kimi/session) */
/* ------------------------------------------------------------------ */
function appSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  try {
    for (const line of readFileSync(resolve(root, ".env"), "utf8").split("\n")) {
      const m = line.match(/^\s*APP_SECRET\s*=\s*(.+)\s*$/);
      if (m) return m[1];
    }
  } catch {
    /* no .env */
  }
  return null;
}
const b64u = (buf) =>
  Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function mintSession(unionId, secret) {
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64u(
    JSON.stringify({ unionId, clientId: "e2e", iat: now, exp: now + 86400 }),
  );
  const sig = createHmac("sha256", Buffer.from(secret, "utf8"))
    .update(`${header}.${payload}`)
    .digest();
  return `${header}.${payload}.${b64u(sig)}`;
}
const SECRET = appSecret();
const cookies = SECRET
  ? {
      analyst: mintSession("e2e-analyst", SECRET),
      executive: mintSession("e2e-executive", SECRET),
      sim: mintSession("e2e-sim", SECRET),
    }
  : null;
function requireAuth(who) {
  if (!cookies) throw skip("no APP_SECRET available to mint sessions");
  return cookies[who];
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */
async function req(method, path, { body, cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (body !== undefined) h["Content-Type"] = "application/json";
  if (cookie) h.Cookie = `kimi_sid=${cookie}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* text body (e.g. /metrics) */
  }
  return { status: res.status, json, text };
}

/** tRPC query over HTTP (superjson envelope, matches api/middleware.ts). */
async function trpcQuery(proc, input, cookie) {
  const q = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
  const { status, json } = await req("GET", `/api/trpc/${proc}${q}`, { cookie });
  if (json && json.error) {
    const code = json.error.json?.data?.code ?? json.error.json?.code;
    const err = new Error(`tRPC ${proc} → ${status} ${code}: ${json.error.json?.message}`);
    err.trpcCode = code;
    err.httpStatus = status;
    throw err;
  }
  assert(json && json.result, `tRPC ${proc} returned no result (status ${status})`);
  return json.result.data.json;
}
async function trpcMutation(proc, input, cookie) {
  const { status, json } = await req("POST", `/api/trpc/${proc}`, {
    body: { json: input },
    cookie,
  });
  if (json && json.error) {
    const code = json.error.json?.data?.code ?? json.error.json?.code;
    const err = new Error(`tRPC ${proc} → ${status} ${code}: ${json.error.json?.message}`);
    err.trpcCode = code;
    err.httpStatus = status;
    throw err;
  }
  assert(json && json.result, `tRPC ${proc} returned no result (status ${status})`);
  return json.result.data.json;
}

async function pollJob(jobId, cookie, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const env = await trpcQuery("opportunities.generateStatus", { job_id: jobId }, cookie);
    const { status } = env.data;
    if (status === "succeeded" || status === "failed") return env.data;
    if (Date.now() > deadline) throw new Error(`job ${jobId} did not reach terminal state (last: ${status})`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/* ------------------------------------------------------------------ */
/* suite                                                               */
/* ------------------------------------------------------------------ */
async function main() {
  group("health & envelope");
  await test("GET /healthz → 200 ok", async () => {
    const r = await req("GET", "/healthz");
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json.status === "ok", "body.status");
  });
  await test("GET /v1/health → standard envelope {data,meta,audit}", async () => {
    const r = await req("GET", "/v1/health");
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json.data && r.json.meta && r.json.audit, "envelope keys");
    assert(r.json.meta.api_version === "v1", "meta.api_version");
    assert(/^req_/.test(r.json.meta.request_id), "meta.request_id");
  });

  group("jurisdictions");
  await test("GET /v1/jurisdictions?country_code=NG → list envelope", async () => {
    const r = await req("GET", `/v1/jurisdictions?country_code=NG`);
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json.data.items), "data.items array");
    assert(r.json.data.items.length >= 3, "≥3 seeded jurisdictions");
  });
  await test("GET /v1/jurisdictions/:id/profile → profile envelope shape", async () => {
    const r = await req("GET", `/v1/jurisdictions/${JUR}/profile`);
    assert(r.status === 200, `status ${r.status}`);
    const d = r.json.data;
    assert(d.jurisdiction && d.summary && d.scores, "jurisdiction/summary/scores");
    assert(d.jurisdiction.jurisdictionId === JUR, "jurisdiction id");
  });

  group("read surface");
  await test("GET /v1/opportunities/rankings → ranked items", async () => {
    const r = await req("GET", `/v1/opportunities/rankings?jurisdiction_id=${JUR}`);
    assert(r.status === 200, `status ${r.status}`);
    assert(Array.isArray(r.json.data.items) && r.json.data.items.length > 0, "items");
  });
  await test("GET /v1/search → results envelope", async () => {
    const r = await req("GET", `/v1/search?q=education`);
    assert(r.status === 200, `status ${r.status}`);
    assert(r.json.data !== undefined, "data present");
  });

  group("error envelopes");
  await test("404 → REST error envelope shape", async () => {
    const r = await req("GET", `/v1/jurisdictions/jur:does-not-exist/profile`);
    assert(r.status === 404, `status ${r.status}`);
    const e = r.json.error;
    assert(e && typeof e.code === "string", "error.code");
    assert("request_id" in e && "retryable" in e, "error.request_id/retryable");
  });
  await test("403/401 unauthenticated mutation → error envelope", async () => {
    const r = await req("POST", `/v1/briefs`, {
      body: { jurisdiction_id: JUR, title: "unauth probe" },
    });
    assert([401, 403].includes(r.status), `status ${r.status}`);
    const e = r.json.error;
    assert(e && typeof e.code === "string" && typeof e.message === "string", "error envelope");
  });
  await test("opportunities/generate without Idempotency-Key → 400", async () => {
    const r = await req("POST", `/v1/opportunities/generate`, {
      body: { opportunity_id: "opp:edu:digital-classroom-assistants" },
    });
    assert(r.status === 400, `status ${r.status}`);
    assert(r.json.error.code === "IDEMPOTENCY_KEY_REQUIRED", "error.code");
  });

  group("metrics");
  await test("GET /metrics exposes required series", async () => {
    const r = await req("GET", "/metrics");
    assert(r.status === 200, `status ${r.status}`);
    for (const series of [
      "http_request_duration_seconds",
      "jobs_total",
      "jobs_failed_total",
      "simulation_runs_total",
      "llm_routing_decisions_total",
      "ingestion_records_total",
    ]) {
      assert(r.text.includes(series), `series ${series}`);
    }
  });

  group("opportunity generation idempotency (authenticated)");
  let oppJobId = null;
  await test("same Idempotency-Key → same job (deduplicated)", async () => {
    const analyst = requireAuth("analyst");
    const key = `e2e-idem-${Date.now()}`;
    const headers = { "Idempotency-Key": key };
    const r1 = await req("POST", `/v1/opportunities/generate`, {
      body: { opportunity_id: "opp:edu:digital-classroom-assistants" },
      cookie: analyst,
      headers,
    });
    assert(r1.status === 202, `first status ${r1.status}: ${r1.text}`);
    oppJobId = r1.json.data.job_id;
    const r2 = await req("POST", `/v1/opportunities/generate`, {
      body: { opportunity_id: "opp:edu:digital-classroom-assistants" },
      cookie: analyst,
      headers,
    });
    assert(r2.status === 202, `second status ${r2.status}`);
    assert(r2.json.data.job_id === oppJobId, "same job_id on replay");
    assert(r2.json.data.deduplicated === true, "deduplicated flag");
  });
  await test("generation job reaches terminal state (fresh opportunity)", async () => {
    const analyst = requireAuth("analyst");
    // The runner writes deterministic recommendation ids per opportunity, so a
    // previously-generated opportunity fails on a unique constraint. Walk the
    // rankings until one generates successfully.
    const r = await req("GET", `/v1/opportunities/rankings?jurisdiction_id=${JUR}&limit=25`);
    assert(r.status === 200 && Array.isArray(r.json.data.items), "rankings available");
    const ids = r.json.data.items.map((i) => i.opportunity_id ?? i.opportunityId).filter(Boolean);
    assert(ids.length > 0, "at least one opportunity");
    let lastStatus = "unknown";
    let succeeded = false;
    for (const oppId of ids) {
      const gen = await req("POST", `/v1/opportunities/generate`, {
        body: { opportunity_id: oppId },
        cookie: analyst,
        headers: { "Idempotency-Key": `e2e-term-${Date.now()}-${Math.random().toString(36).slice(2, 10)}` },
      });
      assert(gen.status === 202, `generate ${oppId} → ${gen.status}`);
      const job = await pollJob(gen.json.data.job_id, analyst);
      lastStatus = `${oppId}: ${job.status}`;
      if (job.status === "succeeded") {
        succeeded = true;
        break;
      }
    }
    assert(succeeded, `no opportunity generated successfully (last: ${lastStatus})`);
  });

  group("scenario run lifecycle (authenticated)");
  let runId = null;
  await test("create scenario → add run → poll to terminal state", async () => {
    const analyst = requireAuth("analyst");
    const sim = requireAuth("sim");
    const scn = await req("POST", `/v1/scenarios`, {
      body: {
        jurisdiction_id: JUR,
        name: `e2e scenario ${Date.now()}`,
        description: "e2e lifecycle probe",
      },
      cookie: analyst,
    });
    assert(scn.status === 202, `scenario create ${scn.status}: ${scn.text}`);
    const scenarioId = scn.json.data.scenarioId ?? scn.json.data.scenario_id;
    const run = await req("POST", `/v1/scenarios/${scenarioId}/runs`, {
      body: { engine: "forecast", seed: 42 },
      cookie: sim,
      headers: { "Idempotency-Key": `e2e-run-${Date.now()}` },
    });
    assert(run.status === 202, `run create ${run.status}: ${run.text}`);
    runId = run.json.data.simulation_run_id;
    const deadline = Date.now() + 120_000;
    let status = "queued";
    while (!["succeeded", "failed"].includes(status)) {
      const r = await req("GET", `/v1/scenario-runs/${runId}`);
      assert(r.status === 200, `run status ${r.status}`);
      status = r.json.data.status;
      if (Date.now() > deadline) throw new Error(`run stuck in ${status}`);
      if (!["succeeded", "failed"].includes(status)) await new Promise((r2) => setTimeout(r2, 1000));
    }
    assert(status === "succeeded", `terminal status ${status}`);
  });
  await test("run results include uncertainty bands (lower ≤ mean ≤ upper)", async () => {
    if (!runId) throw skip("no run from previous test");
    const env = await trpcQuery("scenarios.runResults", { simulation_run_id: runId });
    const d = env.data;
    assert(d.band === "80%", "80% band");
    assert(Array.isArray(d.series) && d.series.length > 0, "series non-empty");
    for (const p of d.series) {
      assert(p.lower <= p.mean && p.mean <= p.upper, `band at month ${p.month}`);
    }
  });

  group("brief lifecycle + RBAC matrix (authenticated)");
  let briefId = null;
  await test("generate brief → job succeeds", async () => {
    const analyst = requireAuth("analyst");
    const r = await req("POST", `/v1/briefs`, {
      body: {
        jurisdiction_id: JUR,
        template: "executive_memo",
        title: `e2e brief ${Date.now()}`,
      },
      cookie: analyst,
      headers: { "Idempotency-Key": `e2e-brief-${Date.now()}` },
    });
    assert(r.status === 202, `status ${r.status}: ${r.text}`);
    briefId = r.json.data.brief_id;
    const job = await pollJob(r.json.data.job_id, analyst);
    assert(job.status === "succeeded", `job ${job.status}`);
  });
  await test("generated brief has non-empty citations", async () => {
    const analyst = requireAuth("analyst");
    if (!briefId) throw skip("no brief from previous test");
    const env = await trpcQuery("briefs.get", { brief_id: briefId }, analyst);
    const content = env.data.content;
    assert(content, "brief content generated");
    const citations = content.citations_rail ?? [];
    assert(Array.isArray(citations) && citations.length > 0, "citations rail non-empty");
  });
  await test("analyst (policy_analyst) can approve", async () => {
    const analyst = requireAuth("analyst");
    if (!briefId) throw skip("no brief");
    const env = await trpcMutation("briefs.approve", { brief_id: briefId }, analyst);
    assert(env.data.reviewState === "approved", `state ${env.data.reviewState}`);
  });
  await test("analyst CANNOT signOff (RBAC matrix)", async () => {
    const analyst = requireAuth("analyst");
    if (!briefId) throw skip("no brief");
    try {
      await trpcMutation("briefs.signOff", { brief_id: briefId }, analyst);
      throw new Error("analyst signOff unexpectedly succeeded");
    } catch (err) {
      assert(err.httpStatus === 403, `expected 403, got ${err.message}`);
    }
  });
  await test("executive CAN signOff (RBAC matrix)", async () => {
    const exec = requireAuth("executive");
    if (!briefId) throw skip("no brief");
    const env = await trpcMutation("briefs.signOff", { brief_id: briefId }, exec);
    assert(env.data.reviewState === "signed_off", `state ${env.data.reviewState}`);
  });

  group("documents pipeline (authenticated)");
  await test("documents.register with documents service DOWN → processing_mode fallback", async () => {
    const analyst = requireAuth("analyst");
    // The e2e environment does not run services/documents (DOCUMENTS_BASE_URL
    // unset → localhost:8400 unreachable), so the gateway must degrade to its
    // deterministic local fallback processor and FLAG the result.
    const payload = Buffer.from(
      "Kaduna State Fiscal Responsibility Law, 2026. Section 1. Budget discipline.",
      "utf8",
    ).toString("base64");
    const env = await trpcMutation(
      "documents.register",
      {
        title: `e2e fallback doc ${Date.now()}`,
        jurisdiction_id: JUR,
        doc_type: "law",
        filename: "law.txt",
        content_base64: payload,
        idempotency_key: `e2e-doc-${Date.now()}`,
      },
      analyst,
    );
    const d = env.data;
    assert(d.processing_mode === "fallback", `processing_mode ${d.processing_mode}`);
    assert(d.status === "fallback", `status ${d.status}`);
    assert(d.review_state === "in_review", `review_state ${d.review_state}`);
    assert(typeof d.ocr_confidence === "number", "ocr_confidence computed by fallback");
  });

  group("advocacy surface (public)");
  let firstPathwayId = null;
  await test("advocacy.listPathways → pathway summaries envelope", async () => {
    const env = await trpcQuery("advocacy.listPathways");
    assert(Array.isArray(env.data.pathways), "data.pathways array");
    for (const p of env.data.pathways) {
      assert(p.pathwayId && p.sector && p.title, "pathway summary shape");
    }
    firstPathwayId = env.data.pathways[0]?.pathwayId ?? null;
  });
  await test("advocacy.stakeholderMap → nodes/edges graph", async () => {
    const env = await trpcQuery("advocacy.stakeholderMap", {});
    assert(Array.isArray(env.data.nodes) && Array.isArray(env.data.edges), "nodes/edges arrays");
    assert(env.data.nodes.length > 0, "at least one stakeholder node");
    const nodeIds = new Set(env.data.nodes.map((n) => n.stakeholderId));
    for (const e of env.data.edges) {
      assert(nodeIds.has(e.fromId) && nodeIds.has(e.toId), "edges reference included nodes");
    }
  });
  await test("advocacy.stakeholderMap?pathwayId → filtered graph", async () => {
    if (!firstPathwayId) throw skip("no pathways seeded");
    const env = await trpcQuery("advocacy.stakeholderMap", { pathwayId: firstPathwayId });
    assert(Array.isArray(env.data.nodes), "nodes array");
  });

  group("outcomes surface (public)");
  await test("outcomes.listSeries → series envelope for seeded jurisdiction", async () => {
    const env = await trpcQuery("outcomes.listSeries", { jurisdiction_id: JUR });
    assert(env.data.jurisdiction_id === JUR, "jurisdiction_id echo");
    assert(Array.isArray(env.data.series), "series array");
  });

  group("brief rendered export (authenticated)");
  await test("briefs.exportRendered (html) → rendered artifact + audit", async () => {
    const analyst = requireAuth("analyst");
    if (!briefId) throw skip("no brief from lifecycle group");
    const env = await trpcMutation(
      "briefs.exportRendered",
      { brief_id: briefId, format: "html" },
      analyst,
    );
    const d = env.data;
    assert(d.format === "html", `format ${d.format}`);
    assert(typeof d.filename === "string" && d.filename.endsWith(".html"), "filename");
    assert(typeof d.content === "string" && d.content.includes("<"), "rendered HTML content");
  });
  await test("briefs.exportRendered (doc) → Word-compatible artifact", async () => {
    const analyst = requireAuth("analyst");
    if (!briefId) throw skip("no brief from lifecycle group");
    const env = await trpcMutation(
      "briefs.exportRendered",
      { brief_id: briefId, format: "doc" },
      analyst,
    );
    assert(env.data.format === "doc", `format ${env.data.format}`);
    assert(env.data.filename.endsWith(".doc"), "filename");
  });

  group("connectors health");
  await test("ops.freshnessSummary → data freshness envelope", async () => {
    const env = await trpcQuery("ops.freshnessSummary");
    assert(typeof env.data.label === "string", "label present");
    assert("asOf" in env.data, "asOf key present");
  });
  await test("ingestion service /v1/connectors → connector status list", async () => {
    const base = (process.env.INGESTION_BASE_URL || "http://localhost:8300").replace(/\/$/, "");
    let r;
    try {
      r = await fetch(`${base}/v1/connectors`, { signal: AbortSignal.timeout(3000) });
    } catch {
      throw skip(`ingestion service unreachable at ${base} (not part of this stack)`);
    }
    assert(r.status === 200, `status ${r.status}`);
    const body = await r.json();
    assert(Array.isArray(body.data) && body.data.length > 0, "connector status list");
  });

  group("audit chain");
  await test("audit chain verify endpoint → intact chain", async () => {
    const exec = requireAuth("executive");
    const env = await trpcQuery("auditLog.verify", undefined, exec);
    const d = env.data;
    assert(d.chain_valid === true, `chain_valid ${JSON.stringify(d)}`);
    assert(d.events_checked >= 0, "events_checked");
  });

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("e2e crashed:", err);
  process.exit(1);
});
