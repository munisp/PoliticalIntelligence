# ADR-010: Eventing backbone (Kafka API via Redpanda), durable workflows (Temporal), and scoped Dapr adoption

**Status:** Accepted
**Date:** 2025-XX
**Format:** Context / Decision / Rationale / Consequences / Alternatives considered (mirrors `docs/ADRS.md`; ADR-008/009 are reserved by other tracks).

---

## Context

The platform already runs a Redpanda broker (Kafka API-compatible) as its event backbone with a codified 10-topic catalog (`infra/events/topics.json`), typed producers/consumers in the Node API (`api/utils/events.ts`, `api/consumers.ts`), and an in-process job runner (`api/runner.ts` + `api/utils/jobs.ts`) that executes background work (opportunity generation, simulation runs, ingestion triggers) with status persisted in the `jobs` table. The ingestion service additionally has a Dagster orchestration profile (ING-8) for connector scheduling.

As pipelines grow (multi-step ingestion DAGs, long-running simulation runs, cross-service orchestration), three gaps appear:

1. **Durable orchestration.** The in-process runner loses in-flight work on deploy/crash and has no built-in retry/compensation across service boundaries. The ingestion pipeline (`services/ingestion/app/pipeline.py`: fetch → validate → normalize → load → emit) is a natural DAG with real durability requirements (partial failure mid-pipeline must resume, not restart blindly).
2. **Messaging commitment.** We must decide whether Redpanda is the permanent backbone or a dev stand-in for "real Kafka".
3. **Service-integration boilerplate.** Python services talk to Kafka, Redis, and each other with hand-rolled clients; Dapr offers standard building blocks (pub/sub, state, service invocation, secrets) without rewriting apps.

## Decision

1. **Eventing: keep the Kafka API served by Redpanda** as the single event backbone for dev, staging, and prod. Topic catalog, DLQ policy, and consumer groups stay as-is. Real (Apache) Kafka remains a drop-in option because we program strictly to the Kafka protocol (`KAFKA_BROKERS` is the only coupling). **Fluvio is rejected.**
2. **Workflows: adopt Temporal for durable, multi-step workflows**, coexisting with the existing job runner in phases (see `docs/TEMPORAL.md`). First workflows: `IngestionPipelineWorkflow` and `SimulationRunWorkflow`, implemented by a Go worker (`services/workflows-go`) whose activities call the existing Python service HTTP endpoints. The TS API triggers workflows via `@temporalio/client` (`api/bridges/temporal.ts`) and **falls back to the in-process runner when `TEMPORAL_URL` is unset** — zero behavioural change for environments without Temporal.
3. **Dapr: scoped, sidecar adoption only.** Dapr components (`infra/dapr/components/`) standardize three building blocks for the Python services: pub/sub over Redpanda, state over Redis, and local-env secrets for dev. Adoption is opt-in via k8s annotations (`infra/k8s/overlays/staging/dapr-patch.yaml`). **No application rewrite**: existing direct Kafka/Redis clients keep working; Dapr is an integration shim, not an architecture pivot.

## Rationale

- **Redpanda over real Kafka:** single-binary, no ZooKeeper/KRaft cluster to operate, materially lower dev/staging footprint, Kafka-protocol compatible (all producers/consumers/topic tooling unchanged), strong performance per node, and the `rpk` CLI we already use in `redpanda-init`. Protocol compatibility keeps the "real Kafka in prod" escape hatch open at zero code cost.
- **Temporal over a custom job queue:** durable execution, retries with backoff, timeouts, heartbeats, and replay are exactly what long ingestion/simulation runs need and are genuinely hard to build correctly in-house. The in-process runner remains the right tool for short, in-request background jobs; Temporal takes the long, multi-service, failure-prone ones. Phased coexistence avoids a big-bang migration.
- **Dapr scoped:** the sidecar building blocks (pub/sub, state, secrets, service invocation) remove per-service client boilerplate and make the pub/sub backend swappable (Redpanda today, managed Kafka tomorrow) via component YAML, not code. Scoping to building blocks — not actors, not workflows, not a full mesh rewrite — keeps the cognitive and operational budget proportionate.

## Consequences

- Compose stack gains `temporal`, `temporal-ui`, and `temporal-db` (dedicated postgres:16 — kept separate from the postgis service to isolate failure domains and lifecycle).
- k8s gains a dev-grade single-replica Temporal deployment (`infra/k8s/base/temporal.yaml`); HA Temporal (Cassandra/multi-node Postgres, per-service scaling) is a prod follow-up.
- New artifact: `services/workflows-go` (Go worker + Dockerfile). Go toolchain required in CI to build/test it (sandbox lacks `go`; tests are written and gated to CI).
- TS API gains `@temporalio/client` dependency and `workflows.ingestion.runWorkflow` (data_steward) tRPC procedure with runner fallback.
- Dapr sidecars in staging/prod add ~small per-pod CPU/memory overhead; component YAML becomes part of environment config review.
- Migration phases for the legacy job queue are documented in `docs/TEMPORAL.md`; no existing job type is force-migrated.

## Alternatives considered

- **Real Apache Kafka (rejected for now):** 3× operational weight (brokers + KRaft, tuning, upgrades) for workloads that fit comfortably in one Redpanda node; revisit at sustained >50 MB/s or when a managed-Kafka mandate appears.
- **Fluvio (rejected):** overlapping value proposition (lightweight streaming) with a materially smaller ecosystem, Rust-native client story (weaker Python/TS support), no Kafka-protocol compatibility — adopting it would mean rewriting producers/consumers and losing the managed-Kafka escape hatch. It solves a problem we don't have.
- **Custom durable job queue on the existing `jobs` table (rejected for long workflows):** would re-implement retries, heartbeats, visibility timeouts, and compensation — well-understood-hard territory that Temporal already covers with a tested server.
- **Full Dapr adoption (rejected):** rewriting all service comms behind Dapr (actors, Dapr workflows, binding-everything) adds a control plane without proportional benefit at our scale; scoped building-block adoption captures the value.
