"""World Bank Open Data API connector — LIVE, works for ANY ISO3 country.

Pattern (verified live, docs/DATA_SOURCES_REAL.md §1):
  GET https://api.worldbank.org/v2/country/{ISO3}/indicator/{INDICATOR}
      ?format=json&per_page=N&date=YYYY:YYYY

This connector is the generality proof: the same code path ingests
Nigeria (NGA), Kenya (KEN), or any other country without modification.
"""
from __future__ import annotations

from app.models import CanonicalRecord, RawRecord
from app.connectors.base import BaseConnector

BASE_URL = "https://api.worldbank.org/v2"

# Default indicator set (World Bank indicator ids) -> canonical metric keys.
DEFAULT_INDICATORS: dict[str, dict[str, str]] = {
    "NY.GDP.MKTP.KD.ZG": {"metric_key": "gdp_growth", "sector_code": "economy"},
    "SL.UEM.TOTL.ZS": {"metric_key": "unemployment", "sector_code": "labor"},
    "SP.POP.TOTL": {"metric_key": "population", "sector_code": "demographics"},
    "SE.PRM.ENRR": {"metric_key": "school_enrollment", "sector_code": "education"},
    "FP.CPI.TOTL.ZG": {"metric_key": "inflation", "sector_code": "economy"},
    "EG.ELC.ACCS.ZS": {"metric_key": "electricity_access", "sector_code": "energy"},
}


class WorldBankConnector(BaseConnector):
    name = "worldbank"
    description = "World Bank Open Data API — any ISO3 country x indicator set"
    source_id = "worldbank_api"
    license = "CC-BY-4.0"

    REQUIRED_KEYS = ("jurisdiction_id", "sector_code", "metric_key", "value", "period")

    def _url(self, iso3: str, indicator: str, since: str | None) -> str:
        date = f"{since[:4]}:3000" if since else "2000:3000"
        return (
            f"{BASE_URL}/country/{iso3}/indicator/{indicator}"
            f"?format=json&per_page=200&date={date}"
        )

    def fetch(
        self, jurisdiction: str, since: str | None, params: dict
    ) -> list[RawRecord]:
        iso3 = params.get("country_iso3", "NGA")
        indicators = params.get("indicators") or list(DEFAULT_INDICATORS)
        raw: list[RawRecord] = []
        for indicator in indicators:
            url = self._url(iso3, indicator, since)
            body = self.get_json(url)
            # World Bank returns [metadata, data]; data is None when empty.
            observations = body[1] if isinstance(body, list) and len(body) > 1 else []
            raw.append(
                RawRecord(
                    provenance=self.provenance(url, body),
                    payload={"indicator": indicator, "iso3": iso3,
                             "observations": observations or []},
                )
            )
        return raw

    def normalize(self, raw: list[RawRecord]) -> list[CanonicalRecord]:
        out: list[CanonicalRecord] = []
        for rec in raw:
            indicator = rec.payload["indicator"]
            mapping = DEFAULT_INDICATORS.get(
                indicator,
                {"metric_key": indicator.lower().replace(".", "_"),
                 "sector_code": "general"},
            )
            for obs in rec.payload["observations"]:
                if obs.get("value") is None:
                    continue
                out.append(
                    CanonicalRecord(
                        entity="sector_metric",
                        provenance=rec.provenance,
                        data={
                            "jurisdiction_id": obs.get("countryiso3code")
                            or rec.payload["iso3"],
                            "sector_code": mapping["sector_code"],
                            "metric_key": mapping["metric_key"],
                            "indicator_id": indicator,
                            "value": float(obs["value"]),
                            "period": str(obs["date"]),
                            "confidence": 0.95,
                        },
                    )
                )
        return out
