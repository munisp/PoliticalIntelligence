import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "./connection";

export async function activeRegistrations(jurisdictionId?: string) {
  const rows = await getDb().select().from(schema.businessRegistrations);
  return rows.filter(
    (r) =>
      r.status === "active" &&
      (!jurisdictionId || r.jurisdictionId === jurisdictionId),
  );
}

export async function findRegistration(registrationId: string) {
  return getDb().query.businessRegistrations.findFirst({
    where: eq(schema.businessRegistrations.registrationId, registrationId),
  });
}
