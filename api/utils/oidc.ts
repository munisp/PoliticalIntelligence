import * as jose from "jose";
import { findUserByUnionId, upsertUser } from "../queries/users";
import type { User } from "@db/schema";

/**
 * Sovereign IdP option (SEC-1): generic OIDC provider as an ALTERNATIVE auth
 * provider to Kimi OAuth. Selected via AUTH_PROVIDER=keycloak (default:
 * kimi — the Kimi OAuth path in api/kimi is untouched).
 *
 * Env:
 *   OIDC_ISSUER        issuer URL, e.g. http://localhost:8080/realms/policy-twin
 *   OIDC_CLIENT_ID     client id (token audience), e.g. policy-twin-web
 *   OIDC_CLIENT_SECRET client secret (reserved for code-flow exchange)
 *
 * Discovery: `${OIDC_ISSUER}/.well-known/openid-configuration` is fetched
 * once (cached); access tokens are verified against the advertised JWKS via
 * jose. Keycloak realm roles are mapped onto the six platform roles.
 */

export type AuthProvider = "kimi" | "keycloak";

export function authProvider(): AuthProvider {
  return process.env.AUTH_PROVIDER === "keycloak" ? "keycloak" : "kimi";
}

/** Keycloak realm role -> platform role (spec §7, six roles). */
export const KEYCLOAK_ROLE_MAP: Record<string, string> = {
  "executive-consumer": "executive",
  "policy-analyst": "policy_analyst",
  "legal-analyst": "legal_analyst",
  "data-steward": "data_steward",
  "simulation-specialist": "simulation_specialist",
  "platform-administrator": "platform_admin",
};

interface OidcDiscovery {
  issuer: string;
  jwks_uri: string;
}

let discoveryPromise: Promise<OidcDiscovery> | null = null;
let jwks: ReturnType<typeof jose.createRemoteJWKSet> | null = null;

async function discover(): Promise<OidcDiscovery> {
  discoveryPromise ??= (async () => {
    const issuer = process.env.OIDC_ISSUER;
    if (!issuer) throw new Error("OIDC_ISSUER is not configured");
    const resp = await fetch(
      `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`,
    );
    if (!resp.ok) {
      throw new Error(`OIDC discovery failed: HTTP ${resp.status}`);
    }
    return (await resp.json()) as OidcDiscovery;
  })();
  return discoveryPromise;
}

async function getJwks() {
  if (!jwks) {
    const { jwks_uri } = await discover();
    jwks = jose.createRemoteJWKSet(new URL(jwks_uri));
  }
  return jwks;
}

export interface OidcIdentity {
  subject: string;
  name: string;
  email?: string;
  realmRoles: string[];
  platformRole: string;
}

/** Verify a Keycloak/OIDC access token (JWKS, issuer + audience checks). */
export async function verifyOidcToken(token: string): Promise<OidcIdentity> {
  const issuer = process.env.OIDC_ISSUER;
  if (!issuer) throw new Error("OIDC_ISSUER is not configured");
  const { payload } = await jose.jwtVerify(token, await getJwks(), {
    issuer: issuer.replace(/\/$/, ""),
    audience: process.env.OIDC_CLIENT_ID || undefined,
  });
  const realmRoles =
    ((payload.realm_access as { roles?: string[] } | undefined)?.roles ??
      []) as string[];
  const platformRole =
    realmRoles.map((r) => KEYCLOAK_ROLE_MAP[r]).find(Boolean) ??
    "policy_analyst";
  return {
    subject: String(payload.sub),
    name: (payload.name as string) ?? (payload.preferred_username as string) ?? "oidc-user",
    email: payload.email as string | undefined,
    realmRoles,
    platformRole,
  };
}

/**
 * Resolve a platform user from an Authorization: Bearer JWT issued by the
 * sovereign IdP. Users are provisioned on first login with unionId
 * `oidc:<sub>` so both issuers can coexist in the same users table.
 */
export async function authenticateBearer(headers: Headers): Promise<User | null> {
  const auth = headers.get("authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  const identity = await verifyOidcToken(auth.slice(7).trim());
  const unionId = `oidc:${identity.subject}`;
  let user = await findUserByUnionId(unionId);
  if (!user) {
    await upsertUser({
      unionId,
      name: identity.name,
      email: identity.email,
      platformRole: identity.platformRole,
      lastSignInAt: new Date(),
    } as never);
    user = await findUserByUnionId(unionId);
  }
  return user ?? null;
}

/** Test hook: reset cached discovery/JWKS. */
export function resetOidcCache(): void {
  discoveryPromise = null;
  jwks = null;
}
