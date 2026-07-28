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
