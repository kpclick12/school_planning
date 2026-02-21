# School Planning POC (Gothenburg)

Local proof-of-concept for Grundskola capacity planning (ages 6-15), with:
- DuckDB data model
- Dummy data generation
- Local web app (dashboard, forecast, map, planning, export)
- Local PMTiles basemap generated from OpenStreetMap (Gothenburg area)
- DuckDB-driven thematic map overlays

## Project Layout
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/data/schema.sql`
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/data/dummy/*.csv`
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/scripts/build_db.py`
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/scripts/fetch_goteborg_osm.py`
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/scripts/build_pmtiles.sh`
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/app/server.py`
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/web/index.html`
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/tile-proxy/server.js`

## 1) Build database
```bash
cd /Users/johanhellenas/Desktop/projects_codex/planing_schools
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python scripts/build_db.py
```

This creates:
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/data/data.db`

## 2) Start optional OSM tile proxy
```bash
cd /Users/johanhellenas/Desktop/projects_codex/planing_schools/tile-proxy
npm install
npm start
```

Frontend now uses a local PMTiles basemap (`/tiles/goteborg.pmtiles`).
The local tile proxy remains optional if you later want a raster fallback.

## 3) Build Gothenburg PMTiles basemap from OSM
```bash
cd /Users/johanhellenas/Desktop/projects_codex/planing_schools
brew install tippecanoe pmtiles
./scripts/build_pmtiles.sh
```

Output:
- `/Users/johanhellenas/Desktop/projects_codex/planing_schools/web/tiles/goteborg.pmtiles`

## 4) Start the demo app
```bash
cd /Users/johanhellenas/Desktop/projects_codex/planing_schools
. .venv/bin/activate
./scripts/run_demo.sh
```

Open:
- `http://127.0.0.1:8000`

## POC Features
- KPI dashboard by year/scenario
- District capacity table
- Forecast chart 2026-2036 (base/low/high)
- MapLibre map with local PMTiles basemap for Gothenburg
- District balance choropleth from DuckDB (`/api/map/district-balance`)
- School points overlay from DuckDB
- Annual recommendation run
- Constraint editing
- CSV export (Excel-compatible)

## Main API Endpoints
- `GET /api/health`
- `POST /api/recommendations/run`
- `GET /api/kpis`
- `GET /api/forecast`
- `GET /api/district-capacity`
- `GET /api/map/district-balance`
- `GET /api/school-utilization`
- `GET /api/recommendations`
- `GET /api/constraints`
- `PATCH /api/constraints`
- `GET /api/export?dataset=...`
