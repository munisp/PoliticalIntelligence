import type { User } from "@db/schema";
import { PLATFORM_ROLES, type PlatformRole } from "@contracts/entities";
import type { TrpcContext } from "../context";
import { apiError } from "./envelope";

/**
 * Resolve the platform role for a Kimi-authenticated user (spec §7).
 * The graft owner (users.role = "admin") defaults to `executive`;
 * everyone else uses the additive `platformRole` column.
 */
export function resolveRole(user: User): PlatformRole {
  if (user.role === "admin") return "executive";
  const role = (user.platformRole ?? "policy_analyst") as PlatformRole;
  return (PLATFORM_ROLES as readonly string[]).includes(role)
    ? role
    : "policy_analyst";
}

export type AuthedCtx = TrpcContext & { user: User };

/**
 * Role-gate a protected procedure. Throws FORBIDDEN with the standard
 * error envelope when the actor lacks every allowed role.
 * `platform_admin` may act in any capacity EXCEPT executive sign-off.
 */
export function requireRole(
  ctx: AuthedCtx,
  allowed: PlatformRole[],
): PlatformRole {
  const role = resolveRole(ctx.user);
  if (allowed.includes(role)) return role;
  if (role === "platform_admin" && !allowed.includes("executive")) return role;
  throw apiError(ctx, {
    http: "FORBIDDEN",
    code: "FORBIDDEN",
    message: allowed.includes("executive")
      ? "Sign-off requires the executive role"
      : `Requires one of: ${allowed.join(", ")}`,
    retryable: false,
    details: { required: allowed, actual: role },
  });
}

/** Executive-only gate (sign-offs). */
export function requireSignOff(ctx: AuthedCtx): void {
  requireRole(ctx, ["executive"]);
}

/**
 * Read-path scoping (SR-10/SEC-3).
 *
 * The platform has two read tiers:
 *  - the PUBLIC facade (unauthenticated REST /v1 reads and anonymous tRPC
 *    callers): aggregate, non-sensitive reference data, unfiltered;
 *  - AUTHENTICATED actors: scoped to their assigned jurisdictions —
 *    executive/platform_admin are jurisdiction-global, everyone else sees
 *    only rows in their user_jurisdictions grants.
 *
 * `assertJurisdictionRead` / `resolveReadScope` below no-op for anonymous
 * callers (public facade) and enforce strictly once a session exists.
 */

/** Assert read access when the caller is authenticated; no-op if anonymous. */
export async function assertJurisdictionRead(
  ctx: TrpcContext,
  jurisdictionId: string,
): Promise<void> {
  if (!ctx.user) return; // public facade tier
  await assertJurisdictionAccess(ctx as AuthedCtx, jurisdictionId, "read");
}

/**
 * Jurisdictions the actor may READ. Returns null for jurisdiction-global
 * roles (executive, platform_admin) — meaning "no filter"; otherwise the
 * list of granted jurisdiction ids (possibly empty).
 */
export async function accessibleJurisdictionIds(
  ctx: AuthedCtx,
): Promise<string[] | null> {
  const role = resolveRole(ctx.user);
  if (role === "platform_admin" || role === "executive") return null;
  const { jurisdictionsForUser } = await import("../queries/users");
  const grants = await jurisdictionsForUser(ctx.user.id);
  return [...new Set(grants.map((g) => g.jurisdictionId))];
}

/**
 * Resolve the effective jurisdiction filter for a LIST read:
 *  - a requested jurisdiction is asserted (403 when not granted) and used;
 *  - otherwise the actor's accessible set applies (null = unfiltered for
 *    global roles; [] = actor sees nothing).
 * Throws FORBIDDEN via assertJurisdictionAccess.
 */
export async function resolveReadScope(
  ctx: TrpcContext,
  requestedJurisdiction?: string | null,
): Promise<{ jurisdictionId?: string; jurisdictionIds?: string[] }> {
  if (!ctx.user) {
    // Public facade tier: requested filter honored, no scoping.
    return requestedJurisdiction
      ? { jurisdictionId: requestedJurisdiction }
      : {};
  }
  if (requestedJurisdiction) {
    await assertJurisdictionAccess(ctx as AuthedCtx, requestedJurisdiction, "read");
    return { jurisdictionId: requestedJurisdiction };
  }
  const accessible = await accessibleJurisdictionIds(ctx as AuthedCtx);
  if (accessible === null) return {};
  return { jurisdictionIds: accessible };
}

/**
 * Drop rows whose jurisdiction is set and outside the actor's accessible
 * set; rows without jurisdiction metadata are platform-level and pass.
 */
export async function filterReadable<T>(
  ctx: AuthedCtx,
  items: T[],
  getJurisdiction: (item: T) => string | null | undefined,
): Promise<T[]> {
  const accessible = await accessibleJurisdictionIds(ctx);
  if (accessible === null) return items;
  const set = new Set(accessible);
  return items.filter((item) => {
    const jur = getJurisdiction(item);
    return jur == null || set.has(jur);
  });
}

/* ------------------------------------------------------------------ */
/* Jurisdiction-scoped authorization (ABAC)                            */
/* ------------------------------------------------------------------ */

/**
 * Assert the actor may operate within `jurisdictionId`.
 * platform_admin and executive are jurisdiction-global; every other role
 * needs a row in user_jurisdictions (access level >= `minLevel`).
 * Throws FORBIDDEN with the standard error envelope otherwise.
 */
export async function assertJurisdictionAccess(
  ctx: AuthedCtx,
  jurisdictionId: string,
  minLevel: "read" | "write" | "admin" = "read",
): Promise<void> {
  const role = resolveRole(ctx.user);
  if (role === "platform_admin" || role === "executive") return;
  const { jurisdictionsForUser } = await import("../queries/users");
  const grants = await jurisdictionsForUser(ctx.user.id);
  const grant = grants.find((g) => g.jurisdictionId === jurisdictionId);
  const rank = { read: 0, write: 1, admin: 2 } as const;
  if (!grant || rank[grant.accessLevel] < rank[minLevel]) {
    throw apiError(ctx, {
      http: "FORBIDDEN",
      code: "JURISDICTION_ACCESS_DENIED",
      message: `No ${minLevel} access to jurisdiction ${jurisdictionId}`,
      retryable: false,
      details: {
        jurisdiction_id: jurisdictionId,
        required: minLevel,
        granted: grant?.accessLevel ?? null,
      },
    });
  }
}
