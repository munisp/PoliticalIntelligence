import { createRouter, authedQuery } from "./middleware";
import { envelope, apiError } from "./utils/envelope";
import { resolveRole } from "./utils/rbac";
import { verifyAuditChain } from "./utils/auditchain";
import { exportWormNow, verifyWormExports } from "./utils/worm";

/**
 * Tamper-evident audit-log operations: hash-chain verification
 * (utils/auditchain.ts). Restricted to platform_admin / data_steward.
 */
export const auditLogRouter = createRouter({
  verify: authedQuery.query(async ({ ctx }) => {
    const role = resolveRole(ctx.user);
    if (role !== "platform_admin" && role !== "data_steward" && ctx.user.role !== "admin")
      throw apiError(ctx, {
        http: "FORBIDDEN",
        code: "FORBIDDEN",
        message: "Audit verification requires platform_admin or data_steward role",
        details: { actual: role },
      });
    const result = await verifyAuditChain();
    return envelope(result, ctx);
  }),
  /** On-demand WORM export (append-only, hash-anchored) — same role gate. */
  exportWorm: authedQuery.query(async ({ ctx }) => {
    const role = resolveRole(ctx.user);
    if (role !== "platform_admin" && role !== "data_steward" && ctx.user.role !== "admin")
      throw apiError(ctx, {
        http: "FORBIDDEN",
        code: "FORBIDDEN",
        message: "WORM export requires platform_admin or data_steward role",
        details: { actual: role },
      });
    const result = await exportWormNow();
    return envelope(result, ctx);
  }),
  /** Verify WORM export chain continuity. */
  verifyWorm: authedQuery.query(async ({ ctx }) => {
    const role = resolveRole(ctx.user);
    if (role !== "platform_admin" && role !== "data_steward" && ctx.user.role !== "admin")
      throw apiError(ctx, {
        http: "FORBIDDEN",
        code: "FORBIDDEN",
        message: "WORM verification requires platform_admin or data_steward role",
        details: { actual: role },
      });
    const result = verifyWormExports();
    return envelope(result, ctx);
  }),
});
