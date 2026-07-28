# Demo: Lagos–Calabar Coastal Highway evidence pack

A worked example of the platform's core loop: **funded project → opportunities
(including TECHNOLOGY)**. It encodes the Lagos–Calabar Coastal Highway as a
seedable evidence pack grounded in December 2025 public reporting.

## What the pack demonstrates

The corridor facts seeded:

- **700km** coastal highway across **9 states** (Lagos → Cross River).
- **Phase 1 Section 1 (47.5km)** commissioned **May 2025**.
- **Section 2 (55.7km, Eleko → Ode-Omi)** financed at **$1.126B**
  ($626M First Abuja Bank + $500M Afreximbank, ICIEC-wrapped), after **$747M**
  Section 1. Contractor: **Hitech** (CRCP pavement).
- Median reserved for **future rail**; **solar lighting + wind**; links **Lekki
  Deep Sea Port, Dangote Refinery, Lekki Free Zone**.
- Travel time Lagos–Calabar **~14h → ~7h**.

From that single funded project the pack derives **24 opportunities** in five
layers (the layer is tagged in each opportunity's summary as
`[layer:X | states:... | lgas:...]` and exported as `LCH_LAYERS` from the seed
module):

| Layer | Count | Examples |
|---|---|---|
| `direct` (construction supply chain) | 5 | materials supply, equipment leasing, geotech & survey, camp services, CRCP QA/QC labs |
| `corridor` (mobility-enabled) | 4 | trucking & cold chain, truck stops, fuel + EV charging, toll-adjacent retail |
| `asset` (Lekki port/FTZ/refinery) | 3 | warehousing near Lekki Port & FTZ, agro-aggregation to port, export processing |
| `tangential` (second-order) | 4 | tourism & eco-tourism, real estate, fisheries cold chains, insurance services |
| `technology` | 8 | smart tolling & ITS, corridor IoT (structural health/weather/flood), solar-wind O&M + carbon MRV, drone progress analytics, fiber/5G ducting + edge, rail-median systems integration, digital freight matching, GIS/digital-twin asset management for FMW |

Plus:

- **4 `evidence_sources`** rows (State House commissioning release,
  Afreximbank/FAB financing announcement, ESIA disclosure, FMW corridor design
  briefs) and matching **`data_sources`** registry rows with license /
  quality_score / privacy_classification.
- **1 `budgets` row**: Federal Ministry of Works capital line (FY2025,
  ₦1.744trn ≈ $1.126B at ~₦1,550/$), linked to the financing evidence via
  `budgets.source = ev:document:lch-section2-financing-2025`.
- **6 sectors** (construction, logistics, tourism_hospitality, real_estate,
  energy, technology) created if absent.
- **9 corridor-state jurisdictions** (`jur:ng-la` … `jur:ng-ed`) created if
  absent and used as the opportunities' jurisdiction FKs.
- **1 scenario template preset**: *"Lagos–Calabar corridor build-out"*
  (`tpl:lagos-calabar-corridor`) — 84-month horizon, assumptions referencing
  the financing scale, instruments `infrastructure_investment` +
  `logistics_policy`, targeting employment + firm births in the 9 corridor
  states.

## How to seed

```bash
npx tsx db/seed-lagos-calabar.ts
```

Idempotent: existing primary keys are skipped; the scenario template is
upserted. Safe to run after `db/seed.ts` (it reuses `jur:ng` / `jur:ng-la`).

## Where it shows in the UI

- **Opportunities page** — filter by the corridor states (Lagos, Ogun, Ondo,
  Delta, Bayelsa, Rivers, Akwa Ibom, Cross River, Edo) or by the new sectors
  (`technology`, `construction`, `logistics`, `tourism_hospitality`,
  `real_estate`, `energy`). The layer and corridor LGAs are visible in each
  opportunity summary tag.
- **ScenarioBuilder** — the preset *"Lagos–Calabar corridor build-out"*
  (`tpl:lagos-calabar-corridor`, publishedState `approved`) is installable;
  its config references the four corridor interventions.

## Honest provenance note

All pack rows carry **`origin="derived"`**: they are parsed from public
reporting as of **December 2025** (State House releases, Afreximbank/FAB
announcements, FMEnv ESIA disclosure, FMW design briefs), not harvested from a
live connector. Naira figures derived from USD reporting use ~₦1,550/$ and are
approximate by construction.

**Upgrade path:** when the Budget Office connector (`src:budget-office`)
harvests the Federal Ministry of Works appropriation directly, the budget row
and linked evidence should be re-materialized with **`origin="live"`**, real
`sourceUrl` retrieval artifacts, and `fetchedAt` timestamps — the seed's
derived rows are the explicit placeholder for that upgrade.

## Test

`api/tests/lagos-calabar-seed.test.ts` runs the upsert against the dev DB and
asserts: ≥18 opportunities, ≥6 `layer=technology`, non-empty evidence base on
every opportunity, budget ↔ financing-evidence linkage, corridor jurisdictions
present, and the scenario template validating against its zod contract
(`templatePublishInput`).
