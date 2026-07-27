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
