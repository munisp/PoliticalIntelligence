import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";
import type { User } from "@db/schema";
import { authenticateRequest } from "./kimi/auth";

export type TrpcContext = {
  req: Request;
  resHeaders: Headers;
  user?: User;
};

export async function createContext(
  opts: FetchCreateContextFnOptions,
): Promise<TrpcContext> {
  const ctx: TrpcContext = { req: opts.req, resHeaders: opts.resHeaders };
  try {
    // Sovereign IdP option (AUTH_PROVIDER=keycloak): resolve the session
    // from a Keycloak-issued Bearer JWT (api/utils/oidc.ts). The Kimi OAuth
    // cookie path below is untouched and remains the default.
    const { authProvider, authenticateBearer } = await import("./utils/oidc");
    if (authProvider() === "keycloak") {
      const bearerUser = await authenticateBearer(opts.req.headers);
      if (bearerUser) {
        ctx.user = bearerUser;
        return ctx;
      }
    }
  } catch {
    // fall through to the Kimi session path
  }
  try {
    ctx.user = await authenticateRequest(opts.req.headers);
  } catch {
    // Authentication is optional here
  }
  return ctx;
}
