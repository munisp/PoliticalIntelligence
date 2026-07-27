# Jurisdiction Onboarding Packs

A **pack** is a declarative YAML file that fully describes how to onboard a
jurisdiction — no code changes required. The platform reads the pack, runs
the configured live connectors, and upserts canonical entities with
provenance labels (`live` / `derived` / `seed`) end-to-end.

Packs in this repo:

| Pack | Jurisdiction | Country | Proof of |
|---|---|---|---|
| `kaduna-ng/pack.yaml` | Kaduna State | Nigeria (NGA) | Pilot; full connector set |
| `lagos-ng/pack.yaml` | Lagos State | Nigeria (NGA) | Second jurisdiction, same pipeline |
| `nairobi-ke/pack.yaml` | Nairobi County | Kenya (KEN) | Non-Nigeria generality (KES, sw, counties) |

`pack.schema.json` is the JSON Schema every pack validates against.

## Add a new jurisdiction in < 30 minutes

1. **Copy** the nearest pack (`cp -r kaduna-ng my-state-ng`).
2. **Edit `pack.yaml`:**
   - `jurisdiction`: id (`xx-yyy`), name, `country_iso3` (drives the World
     Bank connector), admin levels, currency, languages.
   - `hierarchy.units`: the sub-units (LGAs / counties / districts).
   - `connectors`: adjust `worldbank.country_iso3` + indicator list,
     `overpass.area_name` (the OSM admin-area name — check it exists on
     openstreetmap.org), `hdx.queries`, `budeshi.buyer_names` (Nigeria only).
   - `sectors`, `targets`, `branding`.
   - `seed_policy`: state honestly which entity kinds may fall back to
     `origin=seed` demo data (anything no live source covers).
3. **Validate** against `pack.schema.json` (any JSON-Schema validator +
   a YAML→JSON conversion).
4. **Run** onboarding via the API: `onboarding.onboard {pack_code}` —
   the platform calls the ingestion service (`POST /v1/ingest/{connector}`
   per configured connector) and upserts jurisdictions, admin units,
   sectors, and metrics with provenance columns.
5. **Verify**: `onboarding.jurisdictions` shows the live/derived/seed
   record counts for the new jurisdiction.

## Provenance rules

- Every record produced by a connector is `origin=live` with source URL,
  fetch timestamp, and SHA-256 checksum.
- Rows parsed from downloaded portal files are `origin=derived`.
- Demo fallbacks declared in `seed_policy.allowed` are `origin=seed` —
  visible in API responses and the data-health console, never hidden.

Live sample payloads captured from the real endpoints are committed under
`kaduna-ng/live_samples/` and `nairobi-ke/live_samples/`.
