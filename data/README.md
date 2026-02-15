# Data

## Files
- `schema.sql`: DuckDB schema
- `dummy/`: CSVs with sample data
- `data.db`: Generated DuckDB database (not committed by default)

## Build a local `data.db`
Option A (Python + DuckDB package):
```bash
python3 -m venv .venv
. .venv/bin/activate
pip install duckdb
python scripts/build_db.py
```

Option B (DuckDB CLI):
```bash
duckdb -version
./scripts/build_db.sh
```

The build scripts also expand forecast rows to years 2027-2036 based on the 2026 baseline.
