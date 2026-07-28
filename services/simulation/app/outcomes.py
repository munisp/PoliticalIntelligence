"""Realized-outcome handoff for the simulation service (feature G2).

Coupling design (least-coupled option, per docs/OUTCOMES.md):

  * The platform DB is owned by the API service; the simulation service
    does NOT read it directly.
  * Realized outcome observations (loaded by ingestion via
    ``outcomes.upsertObservations``) are PUSHED to this service with
    ``POST /v1/outcomes`` and held in an in-memory ``OutcomeStore``.
  * ``GET /v1/outcomes/{jurisdiction_id}?indicator=`` reads back whatever
    a loader has pushed (empty -> callers fall back to seeded data).
  * The causal engine and the backtest framework consume the store and
    record ``data_mode`` / ``actuals_source`` so every artifact states
    honestly whether it used realized or synthetic/seeded data.

The store is deliberately process-local: it is a handoff cache, not a
system of record (the platform outcome_series/outcome_observations tables
are). A restart simply means "no realized data pushed yet".
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Backtest metric -> outcome indicator code.
METRIC_TO_INDICATOR = {
    "employment": "EMPLOYMENT_TOTAL",
    "unemployment_rate": "UNEMPLOYMENT_RATE",
    "firm_count": "FIRM_COUNT",
}


@dataclass
class OutcomeStore:
    """Process-local realized-outcome cache keyed (jurisdiction, indicator)."""

    _series: dict[tuple[str, str], dict[str, float]] = field(default_factory=dict)
    _meta: dict[tuple[str, str], dict] = field(default_factory=dict)

    def push(
        self,
        jurisdiction_id: str,
        indicator_code: str,
        observations: list[dict],
        meta: dict | None = None,
    ) -> int:
        """Upsert {period, value} observations; returns count applied."""
        key = (jurisdiction_id, indicator_code)
        series = self._series.setdefault(key, {})
        n = 0
        for obs in observations:
            period = str(obs.get("period", ""))
            value = obs.get("value")
            if not period or value is None:
                continue
            series[period] = float(value)
            n += 1
        if meta:
            self._meta.setdefault(key, {}).update(meta)
        return n

    def series(
        self, jurisdiction_id: str, indicator_code: str
    ) -> tuple[list[str], list[float]]:
        """Sorted (periods, values) for one indicator; empty when absent."""
        series = self._series.get((jurisdiction_id, indicator_code), {})
        periods = sorted(series)
        return periods, [series[p] for p in periods]

    def indicators(self, jurisdiction_id: str) -> list[str]:
        return sorted(k[1] for k in self._series if k[0] == jurisdiction_id)

    def actuals_for_metric(
        self, jurisdiction_id: str, metric: str
    ) -> tuple[list[str], list[float]] | None:
        """Realized actuals for a backtest metric, or None when absent."""
        indicator = METRIC_TO_INDICATOR.get(metric, metric.upper())
        periods, values = self.series(jurisdiction_id, indicator)
        if not periods:
            return None
        return periods, values

    def panel_for(self, jurisdiction_id: str) -> list[dict] | None:
        """Aggregated outcome observations (period/value records) across all
        pushed indicators for a jurisdiction — the causal engine's realized
        panel input. None when nothing has been pushed."""
        records: list[dict] = []
        for (jur, indicator), series in sorted(self._series.items()):
            if jur != jurisdiction_id:
                continue
            for period in sorted(series):
                records.append({
                    "period": period,
                    "indicator": indicator,
                    "value": series[period],
                })
        return records or None
