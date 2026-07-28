/** API-9: independently deployable boot entrypoint for the 'briefs' domain
 *  service (registry: api/services/index.ts). Run: npm run dev:service:briefs */
import { serveDomain } from "./boot-domain";

await serveDomain("briefs");
