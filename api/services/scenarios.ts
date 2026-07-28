/** API-9: independently deployable boot entrypoint for the 'scenarios' domain
 *  service (registry: api/services/index.ts). Run: npm run dev:service:scenarios */
import { serveDomain } from "./boot-domain";

await serveDomain("scenarios");
