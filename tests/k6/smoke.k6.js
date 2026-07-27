// k6 CI smoke — 30s, a few VUs, sanity thresholds only.
// Gates "server is up and the golden read paths respond" in pre-release CI.
//
//   k6 run tests/k6/smoke.k6.js

import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:3000";
const JUR = __ENV.JURISDICTION_ID || "jur:ng-kd";

export const options = {
  vus: 5,
  duration: "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<5000"],
  },
};

export default function () {
  const targets = [
    [`${BASE_URL}/healthz`, null],
    [`${BASE_URL}/v1/health`, "data"],
    [`${BASE_URL}/v1/jurisdictions/${JUR}/profile`, "data"],
    [`${BASE_URL}/v1/opportunities/rankings?jurisdiction_id=${JUR}`, "data"],
    [`${BASE_URL}/v1/search?q=education`, "data"],
  ];
  for (const [url, field] of targets) {
    const res = http.get(url);
    check(res, {
      [`${url} status 200`]: (r) => r.status === 200,
      [`${url} shape ok`]: (r) =>
        field === null || JSON.parse(r.body)[field] !== undefined,
    });
  }
}
