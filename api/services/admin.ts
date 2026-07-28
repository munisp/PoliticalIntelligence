/** API-9: independently deployable boot entrypoint for the 'admin' domain
 *  service (registry: api/services/index.ts). Run: npm run dev:service:admin */
import { serveDomain } from "./boot-domain";

await serveDomain("admin");
