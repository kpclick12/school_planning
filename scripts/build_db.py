import os
import sys

try:
    import duckdb
except Exception as e:
    print("DuckDB Python package not installed.")
    print("Activate a venv and run: pip install duckdb")
    raise

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
DUMMY_DIR = os.path.join(DATA_DIR, "dummy")
DB_PATH = os.path.join(DATA_DIR, "data.db")
SCHEMA_PATH = os.path.join(DATA_DIR, "schema.sql")

if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

con = duckdb.connect(DB_PATH)

with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
    con.execute(f.read())

con.execute("COPY districts FROM ? (HEADER, DELIMITER ',')", [os.path.join(DUMMY_DIR, "districts.csv")])
con.execute("COPY schools FROM ? (HEADER, DELIMITER ',')", [os.path.join(DUMMY_DIR, "schools.csv")])
con.execute("COPY students FROM ? (HEADER, DELIMITER ',')", [os.path.join(DUMMY_DIR, "students.csv")])
con.execute("COPY scenarios FROM ? (HEADER, DELIMITER ',')", [os.path.join(DUMMY_DIR, "scenarios.csv")])
con.execute("COPY forecast FROM ? (HEADER, DELIMITER ',')", [os.path.join(DUMMY_DIR, "forecast.csv")])
con.execute("COPY constraints FROM ? (HEADER, DELIMITER ',')", [os.path.join(DUMMY_DIR, "constraints.csv")])

# Expand forecast to 2026-2036 from the 2026 baseline if years are missing.
for scenario_id, yearly_change in [("base", -0.015), ("low", -0.022), ("high", -0.008)]:
    con.execute(
        """
        INSERT INTO forecast (district_id, year, scenario_id, expected_students)
        SELECT
          f.district_id,
          y.year,
          ? AS scenario_id,
          CAST(ROUND(f.expected_students * POW(1 + ?, (y.year - 2026))) AS INTEGER) AS expected_students
        FROM forecast f
        JOIN (
          SELECT range AS year
          FROM range(2027, 2037)
        ) y ON TRUE
        WHERE f.year = 2026 AND f.scenario_id = ?
        """,
        [scenario_id, yearly_change, scenario_id],
    )

con.close()
print(f"Created {DB_PATH}")
