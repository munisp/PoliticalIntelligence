import { eq } from "drizzle-orm";
import * as schema from "@db/schema";
import { getDb } from "../queries/connection";
import type { TrpcContext } from "../context";
import type { User } from "@db/schema";

/** Idempotently ensure a demo user with a given platform role exists. */
export async function ensureUser(
  unionId: string,
  platformRole: string,
  name = unionId,
): Promise<User> {
  const db = getDb();
  const existing = await db.query.users.findFirst({
    where: eq(schema.users.unionId, unionId),
  });
  if (existing) {
    if (existing.platformRole !== platformRole) {
      await db
        .update(schema.users)
        .set({ platformRole })
        .where(eq(schema.users.unionId, unionId));
      return { ...existing, platformRole };
    }
    return existing;
  }
  await db.insert(schema.users).values({
    unionId,
    name,
    email: `${unionId}@example.test`,
    role: "user",
    platformRole,
  });
  const created = await db.query.users.findFirst({
    where: eq(schema.users.unionId, unionId),
  });
  if (!created) throw new Error(`failed to create test user ${unionId}`);
  return created;
}

export function anonCtx(): TrpcContext {
  return { req: new Request("http://test.local/"), resHeaders: new Headers() };
}

export function ctxFor(user: User): TrpcContext {
  return {
    req: new Request("http://test.local/"),
    resHeaders: new Headers(),
    user,
  };
}
