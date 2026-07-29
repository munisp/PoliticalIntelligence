import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
// @ts-expect-error no bundled types for js-yaml (transitive dep)
import yaml from "js-yaml";

/**
 * Partials sweep: SEC-5 (TLS + Vault/ESO), ENV-2 (weighted canary),
 * ENV-4 (ApplicationSet per env) — structural assertions over the real
 * manifests.
 */

const ROOT = path.resolve(import.meta.dirname, "../..");
const loadAll = (rel: string, opts: { stripTemplates?: boolean } = {}) => {
  let text = readFileSync(path.join(ROOT, rel), "utf8");
  if (opts.stripTemplates) {
    // Argo CD ApplicationSet uses go-template blocks that are not valid YAML;
    // drop those lines for structural assertions.
    text = text
      .split("\n")
      .filter((l) => !l.includes("{{"))
      .join("\n");
  }
  return yaml.loadAll(text).filter(Boolean) as Array<Record<string, any>>;
};

describe("SEC-5: TLS in transit (cert-manager)", () => {
  it("app Ingress terminates TLS via cert-manager with ssl redirect", () => {
    const [ing] = loadAll("infra/k8s/base/ingress.yaml");
    const ann = ing.metadata.annotations;
    expect(ann["cert-manager.io/cluster-issuer"]).toBe("letsencrypt-prod");
    expect(ann["nginx.ingress.kubernetes.io/force-ssl-redirect"]).toBe("true");
    expect(ing.spec.tls[0].secretName).toBe("policy-twin-tls");
  });

  it("cert-manager issuers: ACME + internal CA chain", () => {
    const docs = loadAll("infra/k8s/base/cert-manager.yaml");
    const issuers = docs.filter((d) => d.kind === "ClusterIssuer")!;
    expect(issuers.map((i) => i.metadata.name).sort()).toEqual([
      "internal-ca",
      "letsencrypt-prod",
      "selfsigned",
    ]);
    const acme = issuers.find((i) => i.metadata.name === "letsencrypt-prod")!;
    expect(acme.spec.acme.server).toContain("letsencrypt.org");
    const ca = docs.find((d) => d.kind === "Certificate")!;
    expect(ca.spec.isCA).toBe(true);
  });

  it("prod overlay wires cert-manager + external-secrets", () => {
    const [k] = loadAll("infra/k8s/overlays/prod/kustomization.yaml");
    expect(k.resources).toContain("../../base/cert-manager.yaml");
    expect(k.resources).toContain("../../base/external-secrets.yaml");
  });
});

describe("SEC-5: Vault secrets via External Secrets Operator", () => {
  it("ClusterSecretStore points at Vault with kubernetes auth", () => {
    const docs = loadAll("infra/k8s/base/external-secrets.yaml");
    const store = docs.find((d) => d.kind === "ClusterSecretStore")!;
    expect(store.spec.provider.vault.server).toContain("vault");
    expect(store.spec.provider.vault.auth.kubernetes.role).toBe("policy-twin");
  });

  it("ExternalSecret materializes platform-secrets from Vault keys", () => {
    const docs = loadAll("infra/k8s/base/external-secrets.yaml");
    const es = docs.find((d) => d.kind === "ExternalSecret")!;
    expect(es.spec.target.name).toBe("platform-secrets");
    const keys = es.spec.data.map((d: any) => d.secretKey);
    expect(keys).toContain("DATABASE_URL");
    expect(keys).toContain("LOADER_API_KEY");
  });
});

describe("ENV-2: weighted canary in staging", () => {
  it("canary Ingress carries nginx canary annotations and its own Service", () => {
    const docs = loadAll("infra/k8s/overlays/staging/canary-ingress.yaml");
    const ing = docs.find((d) => d.kind === "Ingress")!;
    const svc = docs.find((d) => d.kind === "Service")!;
    expect(ing.metadata.annotations["nginx.ingress.kubernetes.io/canary"]).toBe("true");
    const weight = Number(
      ing.metadata.annotations["nginx.ingress.kubernetes.io/canary-weight"],
    );
    expect(weight).toBeGreaterThan(0);
    expect(weight).toBeLessThan(50);
    expect(svc.spec.selector.track).toBe("canary");
    expect(ing.spec.rules[0].http.paths[0].backend.service.name).toBe("app-canary");
  });

  it("staging overlay includes the canary ingress + canary deployment", () => {
    const [k] = loadAll("infra/k8s/overlays/staging/kustomization.yaml");
    expect(k.resources).toContain("canary.yaml");
    expect(k.resources).toContain("canary-ingress.yaml");
  });
});

describe("EDGE: APISIX + open-appsec perimeter (feat-mw-edge-authz)", () => {
  it("apisix.yaml: gateway + etcd + admin service + ESO-backed key", () => {
    const docs = loadAll("infra/k8s/edge/apisix.yaml");
    const kinds = docs.map((d) => d.kind).sort();
    expect(kinds).toEqual([
      "ConfigMap",
      "Deployment",
      "Deployment",
      "ExternalSecret",
      "Ingress",
      "Namespace",
      "Service",
      "Service",
      "Service",
    ]);
    const apisix = docs.find(
      (d) => d.kind === "Deployment" && d.metadata.name === "apisix",
    )!;
    const c = apisix.spec.template.spec.containers[0];
    expect(c.image).toContain("apache/apisix");
    // Admin key comes from a Secret (ESO), never inline.
    expect(c.env[0].valueFrom.secretKeyRef.name).toBe("apisix-admin-apikey");
    const es = docs.find((d) => d.kind === "ExternalSecret")!;
    expect(es.spec.data[0].remoteRef.property).toBe("APISIX_ADMIN_KEY");
    const cm = docs.find((d) => d.kind === "ConfigMap")!;
    expect(cm.data["config.yaml"]).toContain("$(APISIX_ADMIN_KEY)");
    expect(cm.data["config.yaml"]).toContain("openid-connect");
  });

  it("apisix-routes.yaml: app route proxies to app:3000 with plugin chain", () => {
    const docs = loadAll("infra/k8s/edge/apisix-routes.yaml");
    const routes = docs.filter((d) => d.kind === "ApisixRoute");
    expect(routes.length).toBe(2);
    const app = routes.find((r) => r.metadata.name === "app")!;
    const http = app.spec.http[0];
    expect(http.backends[0].serviceName).toBe("app");
    expect(http.backends[0].serviceNamespace).toBe("policy-twin");
    expect(Number(http.backends[0].servicePort)).toBe(3000);
    const plugins = http.plugins.map((p: any) => p.name);
    expect(plugins).toContain("open-appsec");
    expect(plugins).toContain("limit-req");
    expect(plugins).toContain("cors");
    // oidc at the edge is a commented template, not live config.
    const text = JSON.stringify(app);
    expect(text).not.toContain('"openid-connect"');
  });

  it("openappsec.yaml: WAF agent in detect mode for staging", () => {
    const docs = loadAll("infra/k8s/edge/openappsec.yaml");
    const dep = docs.find((d) => d.kind === "Deployment")!;
    expect(dep.spec.template.spec.containers[0].image).toContain("openappsec");
    const cm = docs.find(
      (d) => d.kind === "ConfigMap" && d.metadata.name === "openappsec-policy",
    )!;
    const policy = cm.data["local_policy.yaml"];
    expect(policy).toContain("mode: detect");
    // prevent must remain a commented option, not active config.
    expect(policy).toContain("# mode: prevent");
    expect(policy).not.toMatch(/^\s+mode: prevent$/m);
  });

  it("no hardcoded secrets in edge manifests", () => {
    for (const rel of [
      "infra/k8s/edge/apisix.yaml",
      "infra/k8s/edge/apisix-routes.yaml",
      "infra/k8s/edge/openappsec.yaml",
    ]) {
      const text = readFileSync(path.join(ROOT, rel), "utf8");
      expect(text).not.toMatch(/password:\s*[^\s#]/i);
      expect(text).not.toMatch(/client_secret:\s*[^\s#${]/i);
      expect(text).not.toContain("edd1c9f034335f136f87ad84b625c8f1");
    }
  });

  it("edge kustomization wires all three manifests", () => {
    const [k] = loadAll("infra/k8s/edge/kustomization.yaml");
    expect(k.resources).toEqual([
      "apisix.yaml",
      "apisix-routes.yaml",
      "openappsec.yaml",
    ]);
  });

  it("base kustomization includes permify; configmap defaults Permify off", () => {
    const [k] = loadAll("infra/k8s/base/kustomization.yaml");
    expect(k.resources).toContain("permify.yaml");
    const [cm] = loadAll("infra/k8s/base/configmap.yaml");
    expect(cm.data.PERMIFY_URL).toBe("");
    expect(cm.data.PERMIFY_TENANT_ID).toBe("t1");
  });
});

describe("ENV-4: ApplicationSet per environment", () => {
  it("generates dev/staging/prod Applications with sync waves", () => {
    const [as] = loadAll("infra/gitops/applicationset.yaml", {
      stripTemplates: true,
    });
    expect(as.kind).toBe("ApplicationSet");
    const envs = as.spec.generators[0].list.elements.map((e: any) => e.env);
    expect(envs).toEqual(["dev", "staging", "prod"]);
    const waves = as.spec.generators[0].list.elements.map((e: any) => Number(e.wave));
    expect(waves).toEqual([0, 1, 2]);
    const prod = as.spec.generators[0].list.elements.find((e: any) => e.env === "prod");
    expect(prod.autoSync).toBe("false"); // prod stays manual
  });
});
