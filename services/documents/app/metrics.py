"""Zero-dependency Prometheus /metrics + env-gated OTel (OBS-1, OBS-3).

Vendored per service as `app/metrics.py` (services stay self-contained;
the canonical copy lives in services/_shared/metrics.py — keep in sync).

Provides:
  * Counter / Gauge / Histogram primitives with Prometheus text exposition.
  * `instrument(app, service_name)` — adds `GET /metrics` plus an HTTP
    middleware recording `http_request_duration_seconds` (histogram) and
    `http_requests_total` (counter), both labeled by service/method/path.
  * Service-domain series (jobs, runs, routing decisions) via the module
    registry: `counter("llm_routing_decisions_total", ...).inc(labels)`.
  * `setup_tracing(app, service_name)` — OpenTelemetry SDK, ONLY when
    OTEL_SDK_ENABLED=true: lazy imports opentelemetry-sdk (optional extra,
    see requirements-extras.txt), OTLP gRPC/HTTP exporter to
    OTEL_EXPORTER_OTLP_ENDPOINT, FastAPI auto-instrumentation. Default:
    complete noop (no import attempted).
"""
from __future__ import annotations

import os
import threading
import time
from typing import Iterable

# ---------------------------------------------------------------------------
# Primitives
# ---------------------------------------------------------------------------
DEFAULT_BUCKETS = (0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0,
                   10.0, 30.0)


def _label_key(labels: dict[str, str] | None) -> tuple[tuple[str, str], ...]:
    return tuple(sorted((labels or {}).items()))


def _format_labels(labels: Iterable[tuple[str, str]]) -> str:
    items = list(labels)
    if not items:
        return ""
    inner = ",".join(f'{k}="{str(v).replace(chr(34), chr(92)+chr(34))}"'
                     for k, v in items)
    return "{" + inner + "}"


class Counter:
    def __init__(self, name: str, help_text: str):
        self.name, self.help_text, self._values = name, help_text, {}
        self._lock = threading.Lock()

    def inc(self, labels: dict[str, str] | None = None, amount: float = 1.0):
        with self._lock:
            key = _label_key(labels)
            self._values[key] = self._values.get(key, 0.0) + amount

    def render(self) -> str:
        out = [f"# HELP {self.name} {self.help_text}",
               f"# TYPE {self.name} counter"]
        with self._lock:
            items = sorted(self._values.items())
        for labels, value in items:
            out.append(f"{self.name}{_format_labels(labels)} {value:g}")
        return "\n".join(out)


class Gauge:
    def __init__(self, name: str, help_text: str):
        self.name, self.help_text, self._values = name, help_text, {}
        self._lock = threading.Lock()

    def set(self, labels: dict[str, str] | None, value: float):
        with self._lock:
            self._values[_label_key(labels)] = value

    def render(self) -> str:
        out = [f"# HELP {self.name} {self.help_text}",
               f"# TYPE {self.name} gauge"]
        with self._lock:
            items = sorted(self._values.items())
        for labels, value in items:
            out.append(f"{self.name}{_format_labels(labels)} {value:g}")
        return "\n".join(out)


class Histogram:
    def __init__(self, name: str, help_text: str,
                 buckets: tuple[float, ...] = DEFAULT_BUCKETS):
        self.name, self.help_text, self.buckets = name, help_text, buckets
        self._buckets: dict[tuple, list[float]] = {}
        self._count: dict[tuple, int] = {}
        self._sum: dict[tuple, float] = {}
        self._lock = threading.Lock()

    def observe(self, labels: dict[str, str] | None, value: float):
        key = _label_key(labels)
        with self._lock:
            counts = self._buckets.setdefault(key, [0.0] * len(self.buckets))
            for i, edge in enumerate(self.buckets):
                if value <= edge:
                    counts[i] += 1
            self._count[key] = self._count.get(key, 0) + 1
            self._sum[key] = self._sum.get(key, 0.0) + value

    def render(self) -> str:
        out = [f"# HELP {self.name} {self.help_text}",
               f"# TYPE {self.name} histogram"]
        with self._lock:
            keys = sorted(self._buckets)
            snapshot = [(k, list(self._buckets[k]), self._count[k],
                         self._sum[k]) for k in keys]
        for key, counts, total, summ in snapshot:
            base = tuple(key)
            for edge, c in zip(self.buckets, counts):
                out.append(
                    f"{self.name}_bucket"
                    f"{_format_labels(base + (('le', f'{edge:g}'),))} {c:g}")
            out.append(
                f"{self.name}_bucket"
                f"{_format_labels(base + (('le', '+Inf'),))} {total}")
            out.append(f"{self.name}_count{_format_labels(base)} {total}")
            out.append(f"{self.name}_sum{_format_labels(base)} {summ:g}")
        return "\n".join(out)


class Registry:
    def __init__(self):
        self._metrics: dict[str, object] = {}
        self._lock = threading.Lock()

    def counter(self, name: str, help_text: str = "") -> Counter:
        with self._lock:
            m = self._metrics.setdefault(name, Counter(name, help_text or name))
        return m  # type: ignore[return-value]

    def gauge(self, name: str, help_text: str = "") -> Gauge:
        with self._lock:
            m = self._metrics.setdefault(name, Gauge(name, help_text or name))
        return m  # type: ignore[return-value]

    def histogram(self, name: str, help_text: str = "",
                  buckets: tuple[float, ...] = DEFAULT_BUCKETS) -> Histogram:
        with self._lock:
            m = self._metrics.setdefault(
                name, Histogram(name, help_text or name, buckets))
        return m  # type: ignore[return-value]

    def render(self) -> str:
        with self._lock:
            metrics = list(self._metrics.values())
        return "\n".join(m.render() for m in metrics) + "\n"  # type: ignore


registry = Registry()


def counter(name: str, help_text: str = "") -> Counter:
    return registry.counter(name, help_text)


def gauge(name: str, help_text: str = "") -> Gauge:
    return registry.gauge(name, help_text)


def histogram(name: str, help_text: str = "", **kw) -> Histogram:
    return registry.histogram(name, help_text, **kw)


# ---------------------------------------------------------------------------
# FastAPI instrumentation
# ---------------------------------------------------------------------------
def instrument(app, service_name: str) -> None:
    """Mount GET /metrics and record request latency/counts per route."""
    from fastapi import Request
    from fastapi.responses import PlainTextResponse

    requests = counter("http_requests_total", "HTTP requests")
    latency = histogram("http_request_duration_seconds",
                        "HTTP request latency")
    info = gauge("service_info", "Service build info")
    info.set({"service": service_name}, 1.0)

    @app.middleware("http")
    async def _metrics_middleware(request: Request, call_next):
        started = time.monotonic()
        response = await call_next(request)
        route = request.scope.get("route")
        path = getattr(route, "path", request.url.path)
        labels = {"service": service_name, "method": request.method,
                  "path": path, "status": str(response.status_code)}
        requests.inc(labels)
        latency.observe(labels, time.monotonic() - started)
        return response

    @app.get("/metrics", include_in_schema=False)
    async def _metrics():
        return PlainTextResponse(registry.render())


# ---------------------------------------------------------------------------
# OpenTelemetry (env-gated; noop by default)
# ---------------------------------------------------------------------------
def setup_tracing(app, service_name: str) -> bool:
    """Enable OTel tracing only when OTEL_SDK_ENABLED=true.

    Lazy-imports opentelemetry-sdk (optional extra); exports spans to
    OTEL_EXPORTER_OTLP_ENDPOINT (default http://otel-collector:4318). Any
    failure degrades to a logged noop — the service must never fail to boot
    because telemetry is misconfigured.
    """
    if os.getenv("OTEL_SDK_ENABLED", "").lower() not in ("1", "true", "yes"):
        return False
    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter)
        from opentelemetry.instrumentation.fastapi import (
            FastAPIInstrumentor)
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor

        endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT",
                             "http://otel-collector:4318")
        provider = TracerProvider(resource=Resource.create(
            {"service.name": service_name}))
        provider.add_span_processor(BatchSpanProcessor(
            OTLPSpanExporter(endpoint=f"{endpoint.rstrip('/')}/v1/traces")))
        trace.set_tracer_provider(provider)
        FastAPIInstrumentor.instrument_app(app)
        return True
    except Exception as exc:  # optional extra missing or collector down
        import logging
        logging.getLogger("otel").warning(
            "OTEL_SDK_ENABLED but tracing setup failed (noop): %s", exc)
        return False
