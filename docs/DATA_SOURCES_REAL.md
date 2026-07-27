# Real Data Sources for a Policy-Intelligence Connector Layer (Nigeria + generic)

All endpoints below were probed live (curl) on the research date. Status values:

- **LIVE-API** — programmatic JSON/CSV endpoint, verified responding with data.
- **DOWNLOAD** — machine-readable files (CSV/XLSX/SHP/PDF-bulletin) published on a portal; no stable query API, but bulk/scheduled ingestion is feasible.
- **PORTAL-MANUAL** — data exists only via interactive web UI / PDFs; scraping or manual extraction required.
- **NONE / UNREACHABLE** — site down, or no public machine-readable access.

---

## 1. World Bank Open Data API — **LIVE-API** (verified)

- **Base URL:** `https://api.worldbank.org/v2/`
- **Pattern:** `GET /v2/country/{ISO3}/indicator/{INDICATOR_ID}?format=json&per_page=N&date=YYYY:YYYY`
- **Format:** JSON (`format=json`) or XML; also CSV/Excel bulk via `format=csv` (zip) on download endpoints.
- **Auth:** none. **Cadence:** annual (some quarterly/monthly series); `lastupdated` field in response metadata (observed `2026-07-13`).
- **Generality proof:** identical pattern verified for **NGA** and **KEN** (Kenya population returned 57,532,493 for 2025).

Verified working examples:

| Indicator | Exact curl |
|---|---|
| GDP growth (annual %) | `curl "https://api.worldbank.org/v2/country/NGA/indicator/NY.GDP.MKTP.KD.ZG?format=json&per_page=3&date=2021:2023"` → returned 3.316 (2023), 4.319 (2022), 1.109 (2021) |
| Unemployment, total (% labor force, ILO modeled) | `curl "https://api.worldbank.org/v2/country/NGA/indicator/SL.UEM.TOTL.ZS?format=json&date=2023"` → 3.074 |
| Population, total | `curl "https://api.worldbank.org/v2/country/NGA/indicator/SP.POP.TOTL?format=json&date=2023"` |
| School enrollment, primary (% gross) | `curl "https://api.worldbank.org/v2/country/NGA/indicator/SE.PRM.ENRR?format=json&date=2018:2020"` (HTTP 200 verified) |
| Kenya (second demo country) | `curl "https://api.worldbank.org/v2/country/KEN/indicator/SP.POP.TOTL?format=json"` (verified) |

Other useful endpoints: `/v2/indicator?format=json&per_page=20000` (indicator catalog), `/v2/country?format=json` (country list), `/v2/sources/2/series/{id}/country/{iso}/time/yr?format=json` (time-granular).

---

## 2. Nigeria NBS (nigerianstat.gov.ng) — **LIVE-API (microdata catalog) + PORTAL-MANUAL (main site)**

- Main site `https://nigerianstat.gov.ng` — HTTP 200. Publications/indicators are page-based (PDFs, HTML tables); **no documented public statistics API**. Status: PORTAL-MANUAL.
- Microdata catalog `https://microdata.nigerianstat.gov.ng` — HTTP 200. Runs **IHSN NADA**, which exposes a REST catalog API:
  - **Verified:** `curl "https://microdata.nigerianstat.gov.ng/index.php/api/catalog/search?ps=2"` → JSON, `found: 107` surveys (e.g., `NGA-NBS-APRM-2006-v1.1`, "African Peer Review Mechanism Survey 2006").
  - Access terms: catalog metadata is open; **microdata files are access-controlled** (`form_model: public/licensed/direct` — most NBS surveys are licensed/direct-access requiring free registration and approval). So: metadata = LIVE-API; the data files themselves = registration-gated.
- Cadence: irregular (survey-driven).

---

## 3. UBEC education factsheets (factsheets.ubecedata.com) — **NONE/UNREACHABLE (as tested)**

- `curl https://factsheets.ubecedata.com` → connection failed (000) at test time; site also has no documented API historically — it is a static factsheet viewer (PDF/image per LGA/school). Status: **PORTAL-MANUAL at best**; UBEC annual digest (ABE/UBEC Digest) published as PDFs on ubec.gov.ng. No machine-readable API found. Manual/bulletin alternative: UBEC Annual Basic Education abstract digests (PDF).

---

## 4. Budget Office + Open Treasury — **DOWNLOAD**

- `https://budgetoffice.gov.ng` — HTTP 200. Publishes **Appropriation Acts, Budget Implementation Reports (quarterly), MTEF/FSP** as **PDF/XLSX downloads**; no API. Status: DOWNLOAD (parse files).
- `https://opentreasury.gov.ng` — **connection failed (000)** at test time; historically (BudgIT-built portal) it published daily/aggregated **Treasury (OTS) payment records as CSV downloads** via `opentreasury.gov.ng` report pages, no stable API. Status: DOWNLOAD-when-up; treat as unreliable, verify before building connector.

---

## 5. CAC (cac.gov.ng) — **NONE (public API)**

- `https://www.cac.gov.ng` → **HTTP 403** to non-browser clients. Company search is available only through the **Company Registration Portal (CRP) / Public Search portal** (pre.cac.gov.ng / search.cac.gov.ng) behind session/captcha, and registered-agent access. **No public open API or bulk download.** Status: PORTAL-MANUAL (captcha-gated). Alternative: none official; some third parties resell CAC lookups.

---

## 6. BPP + procurement open data — **PORTAL-MANUAL (official) / LIVE-API (OCDS via Budeshi)**

- `https://bpp.gov.ng` — connection failed (000) at test time; when up, publishes notices/contract award PDFs and the **NOCOPO portal** (nocopo.bpp.gov.ng) for "Contract Award" disclosures — no public API. Status: PORTAL-MANUAL.
- **OCDS alternative (verified up):** `https://budeshi.ng` — HTTP 200 — PPDC's **Budeshi** platform publishes Nigerian procurement (incl. NOCOPO/BPP and state records) in **Open Contracting Data Standard (OCDS)** format with JSON/CSV downloads (budeshi.ng, API documented at budeshi.ng/Api). This is the practical machine-readable route for Nigerian procurement. Status: **LIVE-API/DOWNLOAD (third-party OCDS)**.

---

## 7. National Assembly + Laws of the Federation — **PORTAL-MANUAL**

- `https://nass.gov.ng` — HTTP 200. Bills/Acts listed as pages + **PDF downloads** (e.g., "Acts of the National Assembly" section); **no API, no structured (Akoma Ntoso) feed**.
- `https://lawsofnigeria.gov.ng` — connection failed (000) at test time; the official Laws of the Federation (LFN) site historically offered HTML/PDF chapter texts, no API.
- **Akoma Ntoso:** Nigeria's National Assembly has an official **AKN project (nass AKN / "Nigeria Akoma Ntoso" via UN/DESA-Africa iLaw lineage)** but no stable public AKN XML endpoint is currently reachable; openbylaws-type projects exist for South Africa only (openbylaws.org.za / laws.africa — **laws.africa** does host some Nigerian legislation in AKN; check laws.africa/place/ng). Status: **PORTAL-MANUAL** for legislation text; PDF parsing is the realistic connector. 

---

## 8. GRID3 + HDX — **LIVE-API (HDX CKAN, verified) / DOWNLOAD (GRID3)**

- **HDX CKAN API (verified):**
  - `curl "https://data.humdata.org/api/3/action/package_search?q=nigeria&rows=2"` → JSON, `success:true`, `count:482` datasets (e.g., "Nigeria - Subnational Administrative Boundaries" COD-AB).
  - Full CKAN action API v3: `package_show?id={name}`, `resource_show`, `datastore_search` for tabular resources; resources link to CSV/SHP/GeoJSON/XLSX. Auth: none for read. Cadence: dataset-specific (CODs updated ~annually; HXL datasets continuous).
- **GRID3 (grid3.org)** — HTTP 200. Datasets (settlement extents, health facilities, schools, population rasters) are distributed **via HDX** (search `org:grid3` / `q=grid3+nigeria` on HDX) and via GRID3's own download forms; some layers on ArcGIS Hub REST. Practical route: ingest GRID3 Nigeria data **through the HDX CKAN API**. Status: **LIVE-API via HDX**.

---

## 9. NERC / NELEX / FMOH HFR — **mixed**

- `https://nerc.gov.ng` — HTTP 200. Statistics = quarterly/annual **reports (PDF)** + some HTML tables; **no API**. Status: PORTAL-MANUAL.
- NELEX (`nelex.ng`) — connection failed (000); when up it is an interactive licensed-power-projects search portal, no API. Status: NONE/UNREACHABLE.
- FMOH Health Facility Registry `https://hfr.fmohconnect.gov.ng` — HTTP 200 (Next.js web app). **No documented public API**; the frontend calls internal endpoints (e.g. `/api/...` returned HTML app shell when probed — not a stable data API). Data is available on request/login. Status: PORTAL-MANUAL. **Alternative:** HFR facility lists are republished on HDX ("Nigeria health facilities" datasets) → ingest via HDX CKAN (LIVE-API path).

---

## 10. OpenStreetMap Overpass API — **LIVE-API (verified via mirror)**

- **Base URL:** `https://overpass-api.de/api/interpreter` (returned 406 to our curl — rate/UA filtering of the sandbox; the public mirror **`https://overpass.kumi.systems/api/interpreter` verified working**, returned OSM JSON).
- **Format:** JSON/XML/CSV (`[out:csv(...)]`). **Auth:** none. **Cadence:** minutely-updated OSM database.
- **Verified working Overpass QL (schools in Kaduna State):**

```
[out:json][timeout:60];
area["name"="Kaduna"]["admin_level"="4"]->.a;
(
  node["amenity"="school"](area.a);
  way["amenity"="school"](area.a);
);
out center;   // or: out count;
```

  `curl -X POST "https://overpass.kumi.systems/api/interpreter" --data 'data=[out:json][timeout:60];area["name"="Kaduna"]["admin_level"="4"]->.a;node["amenity"="school"](area.a);out count;'`
  → returned JSON `{"nodes":"35",...}` (OSM coverage in Kaduna is sparse — 35 tagged schools; use for structure, cross-check counts with official registries). Swap `"school"` for `"clinic"`/`"hospital"` (healthcare) or `"marketplace"` for markets. For production, POST to `overpass-api.de` with a descriptive User-Agent.

---

## 11. Kenya (second demo country)

- **World Bank pattern confirmed for KEN** (see §1 — population query verified live).
- `https://opendata.go.ke` — **connection failed (000)**. Kenya's open data portal (Socrata-based, launched 2011) has been effectively **defunct/unreliable for years**. Status: NONE/UNREACHABLE. Modern Kenyan alternatives: **Kenya National Bureau of Statistics (knbs.or.ke)** — PDF/Excel publications (PORTAL-MANUAL); Kenya data on **HDX** (`q=kenya`) and **World Bank API** (both LIVE-API). ILO data via ILOSTAT API (`https://rplumber.ilo.org/...` ILOSTAT SDMX/CSV bulk at ilostat.ilo.org) — machine-readable, country-parameterized.

---

## Summary table

| # | Source | Endpoint (base) | Format | Auth | Cadence | Status |
|---|--------|-----------------|--------|------|---------|--------|
| 1 | World Bank API | `https://api.worldbank.org/v2/` | JSON/XML/CSV | none | annual+ | **LIVE-API** ✅ |
| 2a | NBS main | `nigerianstat.gov.ng` | HTML/PDF | none | monthly/quarterly pubs | PORTAL-MANUAL |
| 2b | NBS microdata (NADA) | `microdata.nigerianstat.gov.ng/index.php/api/catalog/search` | JSON | none (metadata); registration for files | survey-driven | **LIVE-API (metadata)** ✅ |
| 3 | UBEC factsheets | `factsheets.ubecedata.com` | — | — | — | NONE/UNREACHABLE |
| 4a | Budget Office | `budgetoffice.gov.ng` | PDF/XLSX | none | annual/quarterly | DOWNLOAD |
| 4b | Open Treasury | `opentreasury.gov.ng` | CSV (when up) | none | — | DOWNLOAD (unreliable) |
| 5 | CAC | `cac.gov.ng` | — | captcha/registration | — | PORTAL-MANUAL (403) |
| 6a | BPP/NOCOPO | `bpp.gov.ng` | PDF | none | — | PORTAL-MANUAL (site down) |
| 6b | Budeshi (OCDS) | `budeshi.ng` | OCDS JSON/CSV | none | rolling | **LIVE-API/DOWNLOAD** ✅ |
| 7 | NASS / LFN | `nass.gov.ng` | PDF/HTML | none | per-session | PORTAL-MANUAL |
| 8a | HDX CKAN | `data.humdata.org/api/3/action/` | JSON (+CSV/SHP/GeoJSON resources) | none (read) | continuous | **LIVE-API** ✅ |
| 8b | GRID3 | via HDX (`q=grid3 nigeria`) | GeoTIFF/SHP/CSV | none | periodic | LIVE-API via HDX ✅ |
| 9a | NERC | `nerc.gov.ng` | PDF | none | quarterly | PORTAL-MANUAL |
| 9b | NELEX | `nelex.ng` | — | — | — | NONE/UNREACHABLE |
| 9c | FMOH HFR | `hfr.fmohconnect.gov.ng` | web app | login for data | — | PORTAL-MANUAL (use HDX mirror) |
| 10 | OSM Overpass | `overpass-api.de/api/interpreter` (+ mirrors) | JSON/CSV | none | minutely | **LIVE-API** ✅ |
| 11a | Kenya via World Bank | `api.worldbank.org/v2/country/KEN/...` | JSON | none | annual | **LIVE-API** ✅ |
| 11b | opendata.go.ke | — | — | — | — | NONE/UNREACHABLE (defunct) |

---

## Recommended MVP connector set (live & machine-readable TODAY)

1. **World Bank Open Data API** — generic `{country}/{indicator}` pattern covers Nigeria + any country; the backbone for macro/socioeconomic indicators.
2. **HDX CKAN API** (`data.humdata.org/api/3/action/`) — single integration unlocks 482+ Nigeria datasets incl. GRID3 layers, admin boundaries, health facilities, HXL tabular data.
3. **OSM Overpass API** — live geospatial facility queries (schools/clinics/markets) for any state/country; use mirrors + polite UA for resilience.
4. **NBS NADA microdata catalog API** — JSON survey metadata; alerts on new Nigerian surveys (data files need registration — ingest metadata only).
5. **Budeshi (OCDS)** — machine-readable Nigerian procurement/contract awards without scraping NOCOPO PDFs.
6. **(Downloader, not API) Budget Office + opentreasury file harvester** — scheduled XLSX/PDF fetch + parse for budget/appropriation data.

De-prioritize for MVP (manual/PDF-only or down): CAC, BPP/NOCOPO direct, NERC, NELEX, NASS legislation, UBEC factsheets, HFR direct (use HDX mirror), opendata.go.ke (defunct).
