#!/bin/sh
# Provision the Policy Twin event topic catalog (docs/EVENTS.md, spec §40)
# on Redpanda/Kafka, plus one dead-letter topic per catalog topic.
#
# Idempotent: `rpk topic create` exits non-zero when the topic already
# exists, which we tolerate — re-running converges to the same state.
#
# Usage:
#   scripts/kafka-topics.sh [brokers]     # default redpanda:9092
# Env:
#   RPK_BROKERS   broker list (overridden by $1)
#   PARTITIONS    partitions per topic (default 3)
#   REPLICAS      replication factor (default 1 — single-broker dev)
set -u

BROKERS="${1:-${RPK_BROKERS:-redpanda:9092}}"
PARTITIONS="${PARTITIONS:-3}"
REPLICAS="${REPLICAS:-1}"

# Topic catalog — keep in sync with contracts/entities.ts EventTopics.
TOPICS="
ingest.raw.received
documents.parse.requested
graph.index.updated
features.materialized
scenarios.run.requested
simulations.run.completed
recommendations.generated
reports.generated
audit.events
ops.alerts
"

echo "kafka-topics: provisioning catalog on ${BROKERS} (p=${PARTITIONS} r=${REPLICAS})"

# Wait for the broker to accept connections (compose init runs after the
# healthcheck, but direct invocations may race broker startup).
i=0
until rpk cluster info --brokers "$BROKERS" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    echo "kafka-topics: broker ${BROKERS} not reachable after 30 tries" >&2
    exit 1
  fi
  echo "kafka-topics: waiting for broker (${i}/30)..."
  sleep 2
done

for t in $TOPICS; do
  for name in "$t" "${t}.dlq"; do
    if rpk topic create "$name" --brokers "$BROKERS" \
        --partitions "$PARTITIONS" --replicas "$REPLICAS" 2>/dev/null; then
      echo "  created ${name}"
    else
      # Already exists (or broker rejected) — verify it is listed.
      if rpk topic list --brokers "$BROKERS" 2>/dev/null | grep -q "^${name}\b"; then
        echo "  exists  ${name} (ok)"
      else
        echo "  FAILED  ${name}" >&2
        exit 1
      fi
    fi
  done
done

echo "kafka-topics: done — $(rpk topic list --brokers "$BROKERS" | wc -l | tr -d ' ') topics present"
