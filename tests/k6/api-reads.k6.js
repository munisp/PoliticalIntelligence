// k6 load profile — API read paths (NFR: read latency p95 < 5s, error rate < 1%,
// concurrency 100 concurrent read sessions).
//
//   k6 run tests/k6/api-reads.k6.js
//   BASE_URL=http://staging:3000 k6 run tests/k6/api-reads.k6.js
//
// Read-only: no auth required (publicQuery read surface).

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const JUR = __ENV.JURISDICTION_ID || "jur:ng-kd";

const readLatency = new Trend("nfr_read_latency", true);
const errorRate = new Rate("nfr_error_rate");

export const options = {
  scenarios: {
    constant_reads: {
      executor: "constant-vus",
      vus: 100,
      duration: "5m",
    },
  },
  thresholds: {
    // NFR: Read latency p95 < 5s for dashboard reads.
    http_req_duration: ["p(95)<5000"],
    nfr_read_latency: ["p(95)<5000"],
    // NFR: error rate < 1%.
    http_req_failed: ["rate<0.01"],
    nfr_error_rate: ["rate<0.01"],
  },
};

const PATHS = [
  `/v1/jurisdictions/${JUR}/profile`,
  `/v1/opportunities/rankings?jurisdiction_id=${JUR}`,
  `/v1/search?q=education&jurisdiction_id=${JUR}`,
  `/v1/jurisdictions?country_code=NG`,
  `/v1/legislation/laws?jurisdiction_id=${JUR}`,
];

export default function () {
  const path = PATHS[Math.floor(Math.random() * PATHS.length)];
  const res = http.get(`${BASE_URL}${path}`, {
    tags: { name: path.split("?")[0] },
  });
  readLatency.add(res.timings.duration);
  const ok = check(res, {
    "status 200": (r) => r.status === 200,
    "envelope has data": (r) => {
      try {
        return JSON.parse(r.body).data !== undefined;
      } catch {
        return false;
      }
    },
  });
  errorRate.add(!ok);
  sleep(0.5 + Math.random());
}
