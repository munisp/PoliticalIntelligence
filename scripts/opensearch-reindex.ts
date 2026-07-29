/**
 * Full reindex: bulk-load all canonical MySQL rows into OpenSearch.
 *
 * Usage:
 *   OPENSEARCH_URL=http://localhost:9200 DATABASE_URL=mysql://... \
 *     npx tsx scripts/opensearch-reindex.ts [--kind documents|laws|opportunities|stakeholders]
 *
 * Idempotent (doc id = entity id); safe to re-run after schema/seed loads.
 */
import { ensureIndices, OpenSearchClient } from "../api/search/opensearch";
import { indexEntities } from "../api/consumers/opensearch-indexer";

const KINDS = ["documents", "laws", "opportunities", "stakeholders"] as const;
type Kind = (typeof KINDS)[number];

async function main(): Promise<void> {
  const url = process.env.OPENSEARCH_URL;
  if (!url) {
    console.error("OPENSEARCH_URL is required");
    process.exit(1);
  }
  const argIdx = process.argv.indexOf("--kind");
  const kinds: Kind[] =
    argIdx >= 0
      ? [process.argv[argIdx + 1] as Kind]
      : [...KINDS];
  const client = new OpenSearchClient({ url });
  if (!(await client.ping())) {
    console.error(`OpenSearch at ${url} is not healthy`);
    process.exit(1);
  }
  const created = await ensureIndices(client);
  if (created.length) console.log(`created indices: ${created.join(", ")}`);
  let failures = 0;
  for (const kind of kinds) {
    const res = await indexEntities(client, kind, []);
    console.log(`${kind}: indexed=${res.indexed} errors=${res.errors}`);
    failures += res.errors;
  }
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("reindex failed:", err);
  process.exit(1);
});
