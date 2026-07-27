import * as cookie from "cookie";
import { Session } from "@contracts/constants";
import type { PlatformRole } from "@contracts/entities";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery } from "./middleware";
import { envelope } from "./utils/envelope";
import { accessibleJurisdictionIds, resolveRole } from "./utils/rbac";

/**
 * Effective permission scopes per platform role (spec §7). Returned by
 * `auth.permissions` so clients can render role-appropriate UI without
 * hardcoding the matrix.
 */
export const ROLE_SCOPES: Record<PlatformRole, string[]> = {
  executive: ["read:all", "signoff"],
  policy_analyst: ["opportunities:generate", "briefs:generate"],
  legal_analyst: ["legislation:review"],
  simulation_specialist: ["scenarios:write"],
  data_steward: ["admin:sources"],
  platform_admin: ["admin:all"],
};

export const authRouter = createRouter({
  me: authedQuery.query((opts) => opts.ctx.user),

  /**
   * Caller identity → role + permission scopes + accessible jurisdictions.
   * `jurisdictions` is "all" for jurisdiction-global roles (executive,
   * platform_admin), otherwise the actor's user_jurisdictions grants.
   */
  permissions: authedQuery.query(async ({ ctx }) => {
    const role = resolveRole(ctx.user);
    const accessible = await accessibleJurisdictionIds(ctx);
    return envelope(
      {
        user_id: ctx.user.id,
        role,
        scopes: ROLE_SCOPES[role],
        jurisdictions: accessible ?? "all",
      },
      ctx,
    );
  }),

  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      }),
    );
    return { success: true };
  }),
});
