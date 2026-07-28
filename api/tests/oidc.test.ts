import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as jose from "jose";
import {
  authenticateBearer,
  authProvider,
  resetOidcCache,
  verifyOidcToken,
} from "../utils/oidc";

/**
 * SEC-1: Keycloak live-path integration — a mock OIDC issuer (in-test
 * discovery document + JWKS server, jose-generated RS256 keypair) with
 * AUTH_PROVIDER=keycloak. A signed JWT must resolve to a platform session
 * user with the realm role mapped onto the platform role.
 */

let server: Server;
let issuer: string;
let privateKey: Awaited<ReturnType<typeof jose.generateKeyPair>>["privateKey"];
let publicJwk: jose.JWK;

const CLIENT_ID = "policy-twin-web";

async function signToken(opts: {
  sub: string;
  roles: string[];
  iss?: string;
  aud?: string;
  name?: string;
}): Promise<string> {
  return new jose.SignJWT({
    realm_access: { roles: opts.roles },
    name: opts.name ?? "OIDC Test User",
    preferred_username: opts.sub,
  })
    .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
    .setSubject(opts.sub)
    .setIssuer(opts.iss ?? issuer)
    .setAudience(opts.aud ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
}

beforeAll(async () => {
  const pair = await jose.generateKeyPair("RS256");
  privateKey = pair.privateKey;
  publicJwk = await jose.exportJWK(pair.publicKey);
  publicJwk.kid = "test-key-1";
  publicJwk.alg = "RS256";

  server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    res.setHeader("Content-Type", "application/json");
    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      const base = url.pathname.replace("/.well-known/openid-configuration", "");
      res.end(JSON.stringify({
        issuer: `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`,
        jwks_uri: `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}/protocol/openid-connect/certs`,
        authorization_endpoint: "http://unused/auth",
        token_endpoint: "http://unused/token",
      }));
      return;
    }
    if (url.pathname.endsWith("/protocol/openid-connect/certs")) {
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${port}/realms/policy-twin`;

  process.env.AUTH_PROVIDER = "keycloak";
  process.env.OIDC_ISSUER = issuer;
  process.env.OIDC_CLIENT_ID = CLIENT_ID;
  resetOidcCache();
});

afterAll(async () => {
  delete process.env.AUTH_PROVIDER;
  delete process.env.OIDC_ISSUER;
  delete process.env.OIDC_CLIENT_ID;
  resetOidcCache();
  await new Promise((resolve) => server.close(resolve));
});

describe("Keycloak OIDC live path (SEC-1)", () => {
  it("selects the keycloak provider via AUTH_PROVIDER", () => {
    expect(authProvider()).toBe("keycloak");
  });

  it("verifies a signed JWT via discovery+JWKS and maps the realm role", async () => {
    const token = await signToken({
      sub: "kc-admin-1",
      roles: ["offline_access", "platform-administrator"],
    });
    const identity = await verifyOidcToken(token);
    expect(identity.subject).toBe("kc-admin-1");
    expect(identity.realmRoles).toContain("platform-administrator");
    expect(identity.platformRole).toBe("platform_admin");
  });

  it("maps every documented realm role onto a platform role", async () => {
    const cases: [string, string][] = [
      ["executive-consumer", "executive"],
      ["policy-analyst", "policy_analyst"],
      ["legal-analyst", "legal_analyst"],
      ["data-steward", "data_steward"],
      ["simulation-specialist", "simulation_specialist"],
      ["platform-administrator", "platform_admin"],
    ];
    for (const [realm, platform] of cases) {
      const identity = await verifyOidcToken(
        await signToken({ sub: `u-${realm}`, roles: [realm] }),
      );
      expect(identity.platformRole).toBe(platform);
    }
    // Unknown roles default to policy_analyst.
    const identity = await verifyOidcToken(
      await signToken({ sub: "u-viewer", roles: ["uma_authorization"] }),
    );
    expect(identity.platformRole).toBe("policy_analyst");
  });

  it("resolves a platform session user from a Bearer JWT (first-login provisioning)", async () => {
    const token = await signToken({
      sub: `kc-${Date.now()}`,
      roles: ["data-steward"],
      name: "Keycloak Steward",
    });
    const headers = new Headers({ authorization: `Bearer ${token}` });
    const user = await authenticateBearer(headers);
    expect(user).toBeTruthy();
    expect(user!.unionId).toMatch(/^oidc:kc-/);
    expect(user!.name).toBe("Keycloak Steward");
    expect(user!.platformRole).toBe("data_steward");
  });

  it("rejects tokens from the wrong issuer or audience", async () => {
    await expect(
      verifyOidcToken(
        await signToken({ sub: "x", roles: [], iss: "http://evil.example" }),
      ),
    ).rejects.toThrow();
    await expect(
      verifyOidcToken(
        await signToken({ sub: "x", roles: [], aud: "other-client" }),
      ),
    ).rejects.toThrow();
  });

  it("returns null when no Bearer header is present", async () => {
    expect(await authenticateBearer(new Headers())).toBeNull();
  });
});
