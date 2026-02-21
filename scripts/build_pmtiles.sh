#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_DIR="$ROOT/map-data/raw"
TILES_DIR="$ROOT/map-data/tiles"
WEB_TILES_DIR="$ROOT/web/tiles"

mkdir -p "$RAW_DIR" "$TILES_DIR" "$WEB_TILES_DIR"

echo "[1/3] Fetching OSM data for Gothenburg from Overpass..."
python3 "$ROOT/scripts/fetch_goteborg_osm.py"

echo "[2/3] Building MBTiles with tippecanoe..."
rm -f "$TILES_DIR/goteborg.mbtiles"

tippecanoe -zg --force \
  --drop-densest-as-needed \
  --extend-zooms-if-still-dropping \
  --simplification=2 \
  -o "$TILES_DIR/goteborg.mbtiles" \
  -L roads:"$RAW_DIR/roads.geojson" \
  -L water_lines:"$RAW_DIR/water_lines.geojson" \
  -L water_polygons:"$RAW_DIR/water_polygons.geojson" \
  -L green_areas:"$RAW_DIR/green_areas.geojson" \
  -L buildings:"$RAW_DIR/buildings.geojson"

echo "[3/3] Converting MBTiles -> PMTiles..."
pmtiles convert "$TILES_DIR/goteborg.mbtiles" "$WEB_TILES_DIR/goteborg.pmtiles"

ls -lh "$WEB_TILES_DIR/goteborg.pmtiles"
echo "PMTiles ready: $WEB_TILES_DIR/goteborg.pmtiles"
