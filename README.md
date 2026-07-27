# Jurisdiction Economic Intelligence & Policy Twin Platform

> **Media assets**: the three PNG assets (`public/auth-topo.png`, `public/pwa-icon-512.png`, `public/og-cover.png`) are generated, not committed. After cloning run `python scripts/generate-assets.py` (requires `pillow`) once before `npm run dev`/`npm run build`.
[![CI](https://github.com/munisp/PoliticalIntelligence/actions/workflows/ci.yml/badge.svg)](https://github.com/munisp/PoliticalIntelligence/actions/workflows/ci.yml)
[![CodeQL](https://github.com/munisp/PoliticalIntelligence/actions/workflows/codeql.yml/badge.svg)](https://github.com/munisp/PoliticalIntelligence/actions/workflows/codeql.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

An **evidence-grounded, sovereign-ready, open-source** policy intelligence and economic digital twin platform for governors, ministries, and public-sector analysts. It ingests official statistics, legislation, budgets, procurement records, and geospatial data for a jurisdiction; turns them into a queryable knowledge backbone; and lets decision-makers explore opportunities, analyze legislation, and run what-if simulations — every answer cited back to its evidence, all models self-hosted in-country.

**Nigeria is the reference deployment** (federal/state/LGA/ward), with pilot sectors: education, SME formation, and procurement-led job creation.

## Features

| Product surface | What it does |
| --------------- | ------------ |
| **Governor dashboard** | Headline indicators, active scenarios, freshness of the jurisdiction's data at a glance |
| **Sector opportunity explorer** | Ranked, evidence-cited investment/policy opportunities per sector (education, SME, procurement-led jobs) |
| **Policy & legislation workbench** | Bills/acts search, comparison, amendment chains, specialist deep-reasoning analyses |
| **Simulation studio** | What-if scenario builder (levers, ensembles, seeds) on the economic twin, reproducible by construction |
| **Executive brief generator** | Async, citation-backed briefs routed across Qwen3 model tiers |
| **Data source health console** | Freshness, quality scores, and onboarding status for every registered source |
| **Copilot** | Evidence-grounded conversational assistant woven through all six screens |

## Repository structure

```
├── src/            # React + Vite + TypeScript PWA frontend
├── api/            # Hono + tRPC API (served by the root Node app)
├── db/             # Drizzle ORM schema + migrations (MySQL)
├── contracts/      # Shared API & event schemas (single source of truth)
├── services/
│   ├── simulation/ # FastAPI scenario engine & economic twin (port 8100)
│   └── ai/         # FastAPI model router, hybrid retrieval, RAG (port 8200)
├── mobile/         # Capacitor wrapper (native iOS/Android shells)
├── infra/
│   ├── docker/     # Full local/staging compose stack + Dockerfile.app + .env.example
│   ├── k8s/        # Kustomize base + dev/staging/prod overlays (GitOps with Argo CD)
│   ├── terraform/  # Foundational cloud resources (stubs, provider-neutral)
│   └── monitoring/ # Prometheus config, alert rules, Grafana dashboard + provisioning
├── docs/           # Engineering delivery pack (architecture, API, data model, …)
└── .github/workflows/ # CI (node/python/docker) + CodeQL
```

## Quickstart

Prerequisites: **Node 20**, **Python 3.12**, **Docker** (with compose).

### Full stack with Docker (recommended)

```bash
cp infra/docker/.env.example .env
docker compose -f infra/docker/docker-compose.yml --env-file .env up --build
```

Then: app http://localhost:3000 · simulation :8100 · ai :8200 · Grafana :3001 · Prometheus :9090 · MinIO console :9001 · Neo4j :7474 · Keycloak :8080.

### Local dev without Docker

```bash
# Root app (frontend + API)
npm install
npm run dev

# Python microservices (separate terminals; ASGI module per service layout)
pip install -r services/simulation/requirements.txt
cd services/simulation && uvicorn main:app --port 8100 --reload

pip install -r services/ai/requirements.txt
cd services/ai && uvicorn main:app --port 8200 --reload
```

(Adjust `main:app` to each service's actual ASGI module if its layout differs. You will still need MySQL/Redpanda/etc. — run just those from the compose file when developing natively.)

## PWA & native mobile

The frontend is an installable PWA (offline-tolerant for low-connectivity field contexts). The `mobile/` directory wraps the same build with **Capacitor** to produce native iOS/Android shells sharing one codebase.

## Testing

```bash
npm run check            # typecheck
npm run build            # production build
npm test                 # node unit tests
cd services/simulation && pytest
cd services/ai && pytest
```

See `docs/TESTING.md` for the full validation strategy (contract tests, dbt data contracts, model eval, simulation calibration, NFRs).

## Documentation

| Doc | Contents |
| --- | -------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Layered reference architecture, data flow, tenancy |
| [docs/API.md](docs/API.md) | API principles, envelopes, endpoint domains, examples |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md) | Canonical entities, representation rules, schema governance |
| [docs/EVENTS.md](docs/EVENTS.md) | Event topic catalog + messaging guidance |
| [docs/ADRS.md](docs/ADRS.md) | ADR-001..007 (models, serving, lakehouse, retrieval) |
| [docs/MODEL_STRATEGY.md](docs/MODEL_STRATEGY.md) | Qwen3-first tiers, routing, GPU sizing |
| [docs/NIGERIA_PILOT.md](docs/NIGERIA_PILOT.md) | Reference deployment, sources, pilot plans |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Environments, secrets, backup/DR, 90-day plan |
| [docs/SECURITY.md](docs/SECURITY.md) | OIDC/RBAC, audit, encryption, NDPC posture |
| [docs/TESTING.md](docs/TESTING.md) | Test layers, NFR table, release gates |
| [infra/k8s/README.md](infra/k8s/README.md) | Kustomize layout + Argo CD promotion |
| [infra/terraform/README.md](infra/terraform/README.md) | Foundational cloud resources |

## Contributing & license

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).
