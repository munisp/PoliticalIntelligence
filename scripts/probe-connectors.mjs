#!/usr/bin/env node
/**
 * Live-connector probe (gap #5). Hits the genuinely-live upstream endpoints
 * used by services/ingestion/app/connectors with hard timeouts, prints a
 * status table, and exits non-zero when any connector regresses.
 *
 * Probed sources (must match the connector base URLs):
 *   worldbank  api.worldbank.org indicator query
 *   hdx        data.humdata.org CKAN package_search
 *   nada       microdata.nigerianstat.gov.ng catalog search
 *   overpass   overpass.kumi.systems status endpoint
 *   iati       IATI Datastore (Azure APIM) — requires a free subscription
 *              key (IATI_API_KEY env, sent as Ocp-Apim-Subscription-Key);
 *              without a key the API answers 401, which is the documented
 *              expected state and reported as WARN (not a regression).
 *
 * Run nightly in CI (see .github/workflows/ci.yml `connector-probe` job,
 * `schedule: cron`). Locally:
 *
 *   node scripts/probe-connectors.mjs           # table + exit code
 *   IATI_API_KEY=… node scripts/probe-connectors.mjs
 *
 * Exit: 0 = all ok/warn, 1 = at least one regression.
 */
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 10_000);

const probes = [
  {
    name: "worldbank",
    url: "https://api.worldbank.org/v2/country/NGA/indicator/SP.POP.TOTL?format=json&per_page=1",
    expect: [200],
  },
  {
    name: "hdx",
    url: "https://data.humdata.org/api/3/action/package_search?q=nigeria&rows=1",
    expect: [200],
  },
  {
    name: "nada",
    url: "https://microdata.nigerianstat.gov.ng/index.php/api/catalog/search?ps=1",
    expect: [200],
  },
  {
    name: "overpass",
    // Mirrors match settings.overpass_mirrors; a 429 (shared-IP throttle)
    // means the service is up, so it is WARN not a regression.
    url: "https://overpass.kumi.systems/api/status",
    expect: [200],
    warn: [429],
    fallbacks: ["https://overpass-api.de/api/status"],
  },
  {
    name: "iati",
    url: "https://api.iatistandard.org/datastore/activity/select?q=recipient_country_code:NG&rows=1",
    expect: process.env.IATI_API_KEY ? [200] : [401],
    headers: process.env.IATI_API_KEY
      ? { "Ocp-Apim-Subscription-Key": process.env.IATI_API_KEY }
      : {},
    note: process.env.IATI_API_KEY
      ? "subscription key supplied"
      : "no IATI_API_KEY — 401 (missing subscription key) is the documented expected state",
  },
];

async function probe({ name, url, expect, warn = [], fallbacks = [], headers = {}, note }) {
  const urls = [url, ...fallbacks];
  let last = null;
  for (const u of urls) {
    const started = Date.now();
    try {
      const res = await fetch(u, {
        headers: {
          "User-Agent": "policy-twin-connector-probe/1.0 (nightly CI live-probe)",
          Accept: "*/*",
          ...headers,
        },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const ms = Date.now() - started;
      if (expect.includes(res.status)) {
        const via = u === url ? "" : ` via fallback ${new URL(u).host}`;
        return {
          name,
          status: res.status,
          ms,
          result: res.status < 400 ? "OK" : "WARN",
          note: `${note ?? ""}${via}`.trim() || undefined,
        };
      }
      last = { status: res.status, ms, err: null };
      if (!warn.includes(res.status)) break; // hard failure, no fallback helps
    } catch (err) {
      last = { status: "-", ms: Date.now() - started, err };
    }
  }
  if (last && warn.includes(last.status)) {
    return {
      name,
      status: last.status,
      ms: last.ms,
      result: "WARN",
      note: `throttled on all mirrors (HTTP ${last.status}) — service reachable`,
    };
  }
  return {
    name,
    status: last?.status ?? "-",
    ms: last?.ms ?? 0,
    result: "FAIL",
    note: last?.err
      ? last.err instanceof Error
        ? last.err.message
        : String(last.err)
      : `expected ${expect.join("/")} on all mirrors`,
  };
}

const results = await Promise.all(probes.map(probe));
const w = (s, n) => String(s).padEnd(n);
console.log(`\n${w("connector", 12)}${w("status", 8)}${w("ms", 8)}${w("result", 8)}note`);
console.log("-".repeat(72));
for (const r of results) {
  console.log(`${w(r.name, 12)}${w(r.status, 8)}${w(r.ms, 8)}${w(r.result, 8)}${r.note ?? ""}`);
}
const failed = results.filter((r) => r.result === "FAIL");
console.log(
  `\n${results.length - failed.length}/${results.length} connectors healthy` +
    (failed.length ? ` — REGRESSION: ${failed.map((f) => f.name).join(", ")}` : ""),
);
process.exit(failed.length > 0 ? 1 : 0);
