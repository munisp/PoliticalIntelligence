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
