/** API-9: independently deployable boot entrypoint for the 'documents-gateway'
 *  domain service (registry: api/services/index.ts).
 *  Run: npm run dev:service:documents-gateway */
import { serveDomain } from "./boot-domain";

await serveDomain("documents-gateway");
