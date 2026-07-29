-- PostGIS init (docs/DATA-STORES.md): idempotent extension bootstrap for
-- the geospatial / operational Postgres store. Runs once on first volume
-- creation via /docker-entrypoint-initdb.d.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
