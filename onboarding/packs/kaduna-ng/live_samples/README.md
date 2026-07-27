# Live samples — captured from real endpoints

Fetched live at onboarding-build time (see docs/DATA_SOURCES_REAL.md for probe log):

- `worldbank_nga_*.json` — World Bank API, `GET /v2/country/NGA/indicator/{id}?format=json&date=2019:2023` (six indicators; e.g. GDP growth 2023 = 3.316, population 2023 = 227,882,945).
- `hdx_search_nigeria_health_facilities.json` — HDX CKAN `package_search?q=nigeria health facilities` (trimmed to 2 results).
- `nada_catalog_search.json` — NBS microdata catalog (IHSN NADA) `catalog/search?ps=2` (107 surveys found).
- `../nairobi-ke/live_samples/worldbank_ken_SP.POP.TOTL.json` — same World Bank code path for Kenya (population 2023 = 55,339,003) — generality proof.

Overpass/Budeshi captures were blocked by sandbox egress at capture time; their
connectors are validated against structurally exact fixtures (see
services/ingestion/tests/fixtures) and the endpoints are verified in
docs/DATA_SOURCES_REAL.md §6, §10.
