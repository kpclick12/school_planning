#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_PATH="$ROOT/data/data.db"
SCHEMA_PATH="$ROOT/data/schema.sql"
DUMMY_DIR="$ROOT/data/dummy"

if ! command -v duckdb >/dev/null 2>&1; then
  echo "duckdb CLI not found. Install DuckDB or use scripts/build_db.py"
  exit 1
fi

duckdb "$DB_PATH" < "$SCHEMA_PATH"

duckdb "$DB_PATH" <<SQL
COPY districts FROM '$DUMMY_DIR/districts.csv' (HEADER, DELIMITER ',');
COPY schools FROM '$DUMMY_DIR/schools.csv' (HEADER, DELIMITER ',');
COPY students FROM '$DUMMY_DIR/students.csv' (HEADER, DELIMITER ',');
COPY scenarios FROM '$DUMMY_DIR/scenarios.csv' (HEADER, DELIMITER ',');
COPY forecast FROM '$DUMMY_DIR/forecast.csv' (HEADER, DELIMITER ',');
COPY constraints FROM '$DUMMY_DIR/constraints.csv' (HEADER, DELIMITER ',');

INSERT INTO forecast (district_id, year, scenario_id, expected_students)
SELECT f.district_id, y.year, 'base', CAST(ROUND(f.expected_students * POW(1 - 0.015, (y.year - 2026))) AS INTEGER)
FROM forecast f
JOIN (SELECT range AS year FROM range(2027, 2037)) y ON TRUE
WHERE f.year = 2026 AND f.scenario_id = 'base';

INSERT INTO forecast (district_id, year, scenario_id, expected_students)
SELECT f.district_id, y.year, 'low', CAST(ROUND(f.expected_students * POW(1 - 0.022, (y.year - 2026))) AS INTEGER)
FROM forecast f
JOIN (SELECT range AS year FROM range(2027, 2037)) y ON TRUE
WHERE f.year = 2026 AND f.scenario_id = 'low';

INSERT INTO forecast (district_id, year, scenario_id, expected_students)
SELECT f.district_id, y.year, 'high', CAST(ROUND(f.expected_students * POW(1 - 0.008, (y.year - 2026))) AS INTEGER)
FROM forecast f
JOIN (SELECT range AS year FROM range(2027, 2037)) y ON TRUE
WHERE f.year = 2026 AND f.scenario_id = 'high';
SQL

echo "Created $DB_PATH"
