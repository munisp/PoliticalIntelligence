"""Platform event emission.

Topics follow the event catalog (contracts/entities.ts EventTopics):
  ingest.raw.received   — after fetch, before normalize
  features.materialized — after canonical records are written

Producer adapter: when KAFKA_BROKERS is set AND kafka-python is installed
(requirements-extras.txt), events go to Redpanda/Kafka; otherwise a noop
stdout adapter keeps the pipeline fully functional offline.
"""
from __future__ import annotations

import json
from typing import Any

from app.config import settings
from app.logging_setup import get_logger

log = get_logger("events")

TOPIC_INGEST_RAW = "ingest.raw.received"
TOPIC_FEATURES_MATERIALIZED = "features.materialized"


class NoopProducer:
    """Logs events to stdout; used when Kafka is not configured."""

    def send(self, topic: str, payload: dict[str, Any]) -> None:
        log.info("event %s %s", topic, json.dumps(payload, default=str)[:500])

    def close(self) -> None:  # noqa: D102
        return None


class KafkaProducerAdapter:
    def __init__(self, brokers: str):
        from kafka import KafkaProducer  # optional extra

        self._producer = KafkaProducer(
            bootstrap_servers=[b.strip() for b in brokers.split(",")],
            value_serializer=lambda v: json.dumps(v, default=str).encode("utf-8"),
        )

    def send(self, topic: str, payload: dict[str, Any]) -> None:
        self._producer.send(topic, payload)

    def close(self) -> None:
        self._producer.flush(5)
        self._producer.close(5)


def build_producer(brokers: str | None = None):
    brokers = brokers if brokers is not None else settings.kafka_brokers
    if not brokers:
        return NoopProducer()
    try:
        return KafkaProducerAdapter(brokers)
    except ImportError:
        log.warning("KAFKA_BROKERS set but kafka-python not installed; using noop")
        return NoopProducer()
