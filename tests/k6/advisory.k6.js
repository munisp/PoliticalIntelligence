// k6 load profile — advisory/generation paths (NFR: advisory p95 < 20s,
// 20 concurrent LLM sessions).
//
// Advisory mutations are authenticated (RBAC: policy_analyst). Provide a
// session cookie minted with tests/e2e/mint-session.mjs:
//
//   SESSION_COOKIE=$(node tests/e2e/mint-session.mjs --union-id e2e-analyst) \
//     k6 run tests/k6/advisory.k6.js
//
// Without SESSION_COOKIE every request is rejected (401/403) and thresholds
// fail — the run then only proves auth enforcement, not advisory latency.

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const JUR = __ENV.JURISDICTION_ID || "jur:ng-kd";
const COOKIE = __ENV.SESSION_COOKIE || "";

const advisoryLatency = new Trend("nfr_advisory_latency", true);
const errorRate = new Rate("nfr_error_rate");

export const options = {
  scenarios: {
    advisory_sessions: {
      executor: "constant-vus",
      vus: 20,
      duration: "5m",
    },
  },
  thresholds: {
    // NFR: Advisory/generation latency p95 < 20s (intake + job status round
    // trip; end-to-end generation completion is bounded by the job runner).
    http_req_duration: ["p(95)<20000"],
    nfr_advisory_latency: ["p(95)<20000"],
    http_req_failed: ["rate<0.01"],
    nfr_error_rate: ["rate<0.01"],
  },
};

let seq = 0;

export default function () {
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": `k6-adv-${__VU}-${__ITER}-${seq++}`,
    Cookie: `kimi_sid=${COOKIE}`,
  };

  // Recommendation intake (202 async job) — copilot/advisory request path.
  const gen = http.post(
    `${BASE_URL}/v1/briefs`,
    JSON.stringify({
      jurisdiction_id: JUR,
      template: "executive_memo",
      title: `k6 advisory probe ${__VU}-${__ITER}`,
    }),
    { headers, tags: { name: "/v1/briefs" } },
  );
  advisoryLatency.add(gen.timings.duration);

  let ok = check(gen, {
    "brief intake 202": (r) => r.status === 202,
  });

  // Poll job status once (advisory round trip).
  if (ok) {
    const jobId = JSON.parse(gen.body).data.job_id;
    const st = http.get(`${BASE_URL}/v1/jobs/${jobId}`, {
      headers,
      tags: { name: "/v1/jobs/:id" },
    });
    advisoryLatency.add(st.timings.duration);
    ok = check(st, { "job status 200": (r) => r.status === 200 }) && ok;
  }
  errorRate.add(!ok);
  sleep(1 + Math.random() * 2);
}
