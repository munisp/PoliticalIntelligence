/** API-9: independently deployable boot entrypoint for the 'legislation' domain
 *  service (registry: api/services/index.ts). Run: npm run dev:service:legislation */
import { serveDomain } from "./boot-domain";

await serveDomain("legislation");
