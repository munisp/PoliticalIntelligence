import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "contracts"),
      "@db": path.resolve(templateRoot, "db"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    env: {
      // Gap #13: silence webhook HTTP fan-out noise during unit tests.
      WEBHOOKS_ENABLED: "false",
    },
    // Gap #14: DB-touching suites (auditchain, worm, data-contracts, …)
    // race when files run concurrently against the shared test schema —
    // run files serially in forked processes. Runtime stays ~2min.
    pool: "forks",
    fileParallelism: false,
    include: [
      "api/**/*.test.ts",
      "api/**/*.spec.ts",
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
    ],
  },
});
