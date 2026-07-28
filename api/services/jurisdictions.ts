/** API-9: independently deployable boot entrypoint for the 'jurisdictions' domain
 *  service (registry: api/services/index.ts). Run: npm run dev:service:jurisdictions */
import { serveDomain } from "./boot-domain";

await serveDomain("jurisdictions");
