# Events

The event backbone is Redpanda (Kafka-compatible). Schemas live in `contracts/` and are enforced at producer build time. Topic names are dot-namespaced: `<domain>.<entity>.<verb>`.

## Topic catalog

| Topic                         | Producer                          | Consumers                                   | Notes                                                                                     |
| ----------------------------- | --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `ingest.raw.received`         | Ingest connectors / upload API    | Parser pipeline, lineage recorder           | One event per raw artifact; payload carries object URI, source id, checksum, cadence tag  |
| `documents.parse.requested`   | Upload API, parser retry logic    | Document parsing workers                    | Heavy work; async-by-default. Keyed by `document_id` for ordering per document            |
| `graph.index.updated`         | Graph indexer                     | AI retrieval service, freshness monitor     | Marks a jurisdiction/entity slice re-indexed in Neo4j; consumers invalidate cached plans  |
| `features.materialized`       | Feature/indicator materializer    | Simulation service, AI retrieval, monitoring| Signals new indicator/features version is queryable; payload includes dataset snapshot id |
| `scenarios.run.requested`     | API gateway (`POST /v1/scenarios`, opportunities) | Simulation service              | Carries scenario id, levers, ensemble size, seed, idempotency key                         |
| `simulations.run.completed`   | Simulation service                | API gateway, AI service, notification fan-out| Includes run manifest + `reproducibility_hash`; failures use same topic with status=failed|
| `recommendations.generated`   | AI service                        | API gateway, audit writer                   | Ranked opportunities/briefs ready; carries generation job id + model routing record       |
| `reports.generated`           | AI service (brief generator)      | API gateway, document store                 | Executive brief PDFs/HTML; payload has object URI + citation manifest                     |
| `audit.events`                | All services (audit interceptor)  | Audit writer → immutable store              | Append-only; 7-year retention; partitioned by month                                       |
| `ops.alerts`                  | Monitoring bridge (alertmanager)  | On-call notifier, data source health console| Mirrors Prometheus alerts for in-product visibility                                       |

## Messaging guidance

- **Retry.** Consumers retry with exponential backoff (e.g. 1s, 5s, 30s, 5m, 30m) and jitter. Retries are bounded; the retry count travels in a message header (`x-retry-count`).
- **Dead-letter queues.** Every topic has a sibling `<topic>.dlq`. After max retries, messages move to the DLQ with the original payload + error context. DLQs are monitored (zero-tolerance alert in staging/prod) and replayable via an admin tool.
- **Deduplication.** Consumers must be idempotent: every event carries a unique `event_id` and (for job-triggering events) the API `idempotency_key`. Consumers record processed `event_id`s (or rely on natural keys like `document_id`/`run_id`) so at-least-once delivery never double-applies effects.
- **Ordering.** Partition keys choose the ordering scope: `document_id` for parse/index flows, `jurisdiction_id` for feature materialization, `scenario_id` for simulation flows. Cross-partition ordering is not assumed; downstream state must tolerate out-of-order arrival across keys.
- **Replay.** Raw events and run manifests are persisted to object storage so projections (graph, search, features) can be rebuilt by replaying topics from retained offsets.
- **Prod isolation.** In production, ingest, simulation, and AI workload domains run on isolated brokers (see `infra/k8s/overlays/prod`) so a stalled consumer in one domain cannot backpressure the others.
