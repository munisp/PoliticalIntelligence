/** API-9: independently deployable boot entrypoint for the 'ops' domain
 *  service (registry: api/services/index.ts). Run: npm run dev:service:ops */
import { serveDomain } from "./boot-domain";

await serveDomain("ops");
