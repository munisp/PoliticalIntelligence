#!/usr/bin/env node
/**
 * Zero-dependency local performance bench — sandbox/CI equivalent of the k6
 * profiles in tests/k6/. Drives concurrent fetch loops against BASE_URL and
 * verifies the NFR latency/error-rate thresholds from docs/TESTING.md:
 *
 *   reads:    p95 < 5s, error rate < 1%   (100 concurrent read sessions)
 *   advisory: p95 < 20s, error rate < 1%  (20 concurrent sessions)
 *
 * Usage:
 *   node tests/perf/local-bench.mjs                 # full NFR profile (~5m)
 *   node tests/perf/local-bench.mjs --smoke         # 30s CI smoke profile
 *   BASE_URL=http://localhost:3000 node tests/perf/local-bench.mjs --smoke
 *
 * Env: BASE_URL (default http://localhost:3000), JURISDICTION_ID,
 *      SESSION_COOKIE (kimi_sid value; enables the advisory group),
 *      READ_VUS / READ_SECONDS / ADVISORY_VUS / ADVISORY_SECONDS overrides.
 *
 * Exit code: 0 when every applicable threshold holds, 1 on breach.
 */

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const JUR = process.env.JURISDICTION_ID || "jur:ng-kd";
const COOKIE = process.env.SESSION_COOKIE || "";
const SMOKE = process.argv.includes("--smoke");

const READ_VUS = Number(process.env.READ_VUS || (SMOKE ? 5 : 100));
const READ_SECONDS = Number(process.env.READ_SECONDS || (SMOKE ? 30 : 300));
const ADV_VUS = Number(process.env.ADVISORY_VUS || (SMOKE ? 2 : 20));
const ADV_SECONDS = Number(process.env.ADVISORY_SECONDS || (SMOKE ? 30 : 300));

const THRESHOLDS = {
  reads: { p95ms: 5000, maxErrorRate: 0.01 },
  advisory: { p95ms: 20000, maxErrorRate: 0.01 },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Run one worker loop for `seconds`, recording durations into `out`. */
async function worker(seconds, makeRequest, out) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const start = performance.now();
    let ok = false;
    try {
      ok = await makeRequest();
    } catch {
      ok = false;
    }
    out.push({ ms: performance.now() - start, ok });
    await sleep(100 + Math.random() * 400);
  }
}

const READ_PATHS = [
  `/v1/jurisdictions/${JUR}/profile`,
  `/v1/opportunities/rankings?jurisdiction_id=${JUR}`,
  `/v1/search?q=education&jurisdiction_id=${JUR}`,
  `/v1/jurisdictions?country_code=NG`,
  `/v1/legislation/laws?jurisdiction_id=${JUR}`,
];

let readSeq = 0;
async function readRequest() {
  const path = READ_PATHS[readSeq++ % READ_PATHS.length];
  const res = await fetch(`${BASE_URL}${path}`);
  if (res.status !== 200) return false;
  const body = await res.json();
  return body && body.data !== undefined;
}

let advSeq = 0;
async function advisoryRequest() {
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": `bench-adv-${Date.now()}-${advSeq++}`,
    Cookie: `kimi_sid=${COOKIE}`,
  };
  const gen = await fetch(`${BASE_URL}/v1/briefs`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jurisdiction_id: JUR,
      template: "executive_memo",
      title: `local-bench advisory probe ${advSeq}`,
    }),
  });
  if (gen.status !== 202) return false;
  const { data } = await gen.json();
  const st = await fetch(`${BASE_URL}/v1/jobs/${data.job_id}`, { headers });
  return st.status === 200;
}

function report(name, samples, threshold) {
  const okSamples = samples.filter((s) => s.ok);
  const errRate = samples.length ? 1 - okSamples.length / samples.length : 1;
  const sorted = okSamples.map((s) => s.ms).sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const p95Pass = p95 < threshold.p95ms;
  const errPass = errRate < threshold.maxErrorRate;
  console.log(`\n[${name}] requests=${samples.length} errors=${(errRate * 100).toFixed(2)}%`);
  console.log(`  p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms`);
  console.log(
    `  NFR p95 < ${threshold.p95ms}ms: ${p95Pass ? "PASS" : "FAIL"} | ` +
      `error rate < ${threshold.maxErrorRate * 100}%: ${errPass ? "PASS" : "FAIL"}`,
  );
  return p95Pass && errPass;
}

async function main() {
  // Preflight: server must be up.
  try {
    const res = await fetch(`${BASE_URL}/healthz`);
    if (res.status !== 200) throw new Error(`healthz ${res.status}`);
  } catch (err) {
    console.error(`FAIL: server not reachable at ${BASE_URL}/healthz (${err.message})`);
    process.exit(1);
  }
  console.log(`local-bench against ${BASE_URL} (smoke=${SMOKE})`);

  let pass = true;

  console.log(`\n== reads: ${READ_VUS} workers x ${READ_SECONDS}s ==`);
  const readSamples = [];
  await Promise.all(
    Array.from({ length: READ_VUS }, () => worker(READ_SECONDS, readRequest, readSamples)),
  );
  pass = report("reads", readSamples, THRESHOLDS.reads) && pass;

  if (COOKIE) {
    console.log(`\n== advisory: ${ADV_VUS} workers x ${ADV_SECONDS}s ==`);
    const advSamples = [];
    await Promise.all(
      Array.from({ length: ADV_VUS }, () => worker(ADV_SECONDS, advisoryRequest, advSamples)),
    );
    pass = report("advisory", advSamples, THRESHOLDS.advisory) && pass;
  } else {
    console.log("\n== advisory: SKIPPED (set SESSION_COOKIE to enable; needs an e2e user) ==");
  }

  console.log(`\n${pass ? "PASS" : "FAIL"}: NFR thresholds ${pass ? "met" : "breached"}`);
  process.exit(pass ? 0 : 1);
}

main().catch((err) => {
  console.error("local-bench crashed:", err);
  process.exit(1);
});
