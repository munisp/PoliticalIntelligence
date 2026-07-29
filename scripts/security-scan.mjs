#!/usr/bin/env node
/**
 * Dependency security gate (gap #18). Runs `npm audit --audit-level=high`
 * (production deps only) and exits non-zero when high/critical
 * vulnerabilities remain after the documented allowlist.
 *
 * Allowlist: each entry must name the advisory (npm id / GHSA) and carry a
 * justification + expiry. Keep it empty unless there is a signed-off,
 * time-boxed exception — the CI security job fails otherwise.
 *
 * Usage:
 *   node scripts/security-scan.mjs            # gate (exit 1 on findings)
 *   node scripts/security-scan.mjs --report   # print table, always exit 0
 *
 * CI: see the `security` job in .github/workflows/ci.yml.
 */
import { execFileSync } from "node:child_process";

/**
 * Documented exceptions. Format:
 *   { id: <npm audit id number>, reason: "...", expires: "YYYY-MM-DD" }
 * Find npm ids via `npm audit --json` → vulnerabilities.*.via[].url/source.
 */
const ALLOWLIST = [
  // example:
  // { id: 1100000, reason: "dev-only ReDoS, no prod path", expires: "2026-06-01" },
];

const reportOnly = process.argv.includes("--report");
const today = new Date().toISOString().slice(0, 10);

let raw;
try {
  raw = execFileSync(
    "npm",
    ["audit", "--omit=dev", "--audit-level=high", "--json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 },
  );
} catch (err) {
  // npm audit exits non-zero when vulnerabilities are found — that's the
  // path we care about; the JSON is still on stdout.
  if (err.stdout) raw = err.stdout;
  else {
    console.error("npm audit failed to run:", err.message);
    process.exit(2);
  }
}

const audit = JSON.parse(raw);
const vulns = audit.vulnerabilities ?? {};

const findings = [];
for (const [pkg, v] of Object.entries(vulns)) {
  if (v.severity !== "high" && v.severity !== "critical") continue;
  const advisories = (v.via ?? []).filter((a) => typeof a === "object");
  for (const adv of advisories) {
    if (adv.severity !== "high" && adv.severity !== "critical") continue;
    findings.push({
      pkg,
      severity: adv.severity,
      id: adv.source,
      title: adv.title,
      url: adv.url,
      fixAvailable: Boolean(v.fixAvailable),
    });
  }
}

const activeAllow = ALLOWLIST.filter((a) => a.expires >= today);
const expired = ALLOWLIST.filter((a) => a.expires < today);
if (expired.length) {
  console.error(
    `allowlist entries EXPIRED (treated as findings): ${expired.map((a) => a.id).join(", ")}`,
  );
}
const unallowed = findings.filter(
  (f) => !activeAllow.some((a) => a.id === f.id),
);

console.log(`\nnpm audit (prod deps, high/critical): ${findings.length} finding(s), ` +
  `${activeAllow.length} allowlisted, ${unallowed.length} unallowed\n`);
const w = (s, n) => String(s).padEnd(n);
if (findings.length) {
  console.log(`${w("package", 28)}${w("severity", 10)}${w("id", 10)}${w("fix", 6)}title`);
  console.log("-".repeat(80));
  for (const f of findings) {
    const mark = activeAllow.some((a) => a.id === f.id) ? " (allowlisted)" : "";
    console.log(
      `${w(f.pkg, 28)}${w(f.severity, 10)}${w(f.id, 10)}${w(f.fixAvailable ? "yes" : "no", 6)}${f.title}${mark}`,
    );
  }
  console.log();
}
if (reportOnly) process.exit(0);
if (unallowed.length || expired.length) {
  console.error(
    "SECURITY GATE FAILED — remediate or add a documented, unexpired allowlist entry in scripts/security-scan.mjs",
  );
  process.exit(1);
}
console.log("security gate: OK");
