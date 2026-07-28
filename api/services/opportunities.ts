/** API-9: independently deployable boot entrypoint for the 'opportunities' domain
 *  service (registry: api/services/index.ts). Run: npm run dev:service:opportunities */
import { serveDomain } from "./boot-domain";

await serveDomain("opportunities");
