#!/usr/bin/env python3
import csv
import io
import json
import math
import os
import posixpath
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

try:
    import duckdb
except Exception as exc:
    raise SystemExit(
        "DuckDB is required. Install with: pip install duckdb"
    ) from exc

ROOT_DIR = Path(__file__).resolve().parent.parent
DB_PATH = ROOT_DIR / "data" / "data.db"
WEB_DIR = ROOT_DIR / "web"


class ApiError(Exception):
    def __init__(self, message, status=400):
        self.message = message
        self.status = status
        super().__init__(message)


def get_db():
    if not DB_PATH.exists():
        raise ApiError(f"Database not found at {DB_PATH}. Run scripts/build_db.py first.", 500)
    return duckdb.connect(str(DB_PATH), read_only=False)


def as_int(params, key, default=None):
    raw = params.get(key, [default])[0]
    if raw is None:
        return None
    try:
        return int(raw)
    except ValueError as exc:
        raise ApiError(f"Invalid integer for {key}: {raw}") from exc


def as_text(params, key, default=None):
    value = params.get(key, [default])[0]
    if value == "":
        return default
    return value


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371.0
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return r * c


def query_rows(sql, args=None):
    args = args or []
    with get_db() as con:
        return con.execute(sql, args).fetchall(), [c[0] for c in con.description]


def query_json(sql, args=None):
    rows, columns = query_rows(sql, args)
    return [dict(zip(columns, row)) for row in rows]


def fetch_constraints():
    data = query_json("SELECT * FROM constraints WHERE constraint_id = 'default'")
    if not data:
        raise ApiError("Missing default constraints row", 500)
    return data[0]


def build_capacity_and_utilization(year, scenario):
    with get_db() as con:
        con.execute("DELETE FROM district_capacity WHERE year = ? AND scenario_id = ?", [year, scenario])
        con.execute("DELETE FROM school_utilization WHERE year = ? AND scenario_id = ?", [year, scenario])

        district_rows = con.execute(
            """
            SELECT
              d.district_id,
              COALESCE(SUM(s.capacity_total), 0) AS capacity_total,
              COALESCE(f.expected_students, 0) AS demand_total
            FROM districts d
            LEFT JOIN schools s
              ON s.district_id = d.district_id
             AND s.status = 'active'
             AND (s.opened_year IS NULL OR s.opened_year <= ?)
             AND (s.closed_year IS NULL OR s.closed_year >= ?)
            LEFT JOIN forecast f
              ON f.district_id = d.district_id
             AND f.year = ?
             AND f.scenario_id = ?
            GROUP BY d.district_id, f.expected_students
            """,
            [year, year, year, scenario],
        ).fetchall()

        for district_id, capacity_total, demand_total in district_rows:
            surplus_deficit = int(capacity_total) - int(demand_total)
            con.execute(
                """
                INSERT INTO district_capacity (district_id, year, scenario_id, capacity_total, demand_total, surplus_deficit)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                [district_id, year, scenario, int(capacity_total), int(demand_total), surplus_deficit],
            )

        school_rows = con.execute(
            """
            SELECT
              s.school_id,
              s.district_id,
              s.capacity_total,
              dc.capacity_total AS district_capacity,
              dc.demand_total AS district_demand
            FROM schools s
            JOIN district_capacity dc
              ON dc.district_id = s.district_id
             AND dc.year = ?
             AND dc.scenario_id = ?
            WHERE s.status = 'active'
              AND (s.opened_year IS NULL OR s.opened_year <= ?)
              AND (s.closed_year IS NULL OR s.closed_year >= ?)
            """,
            [year, scenario, year, year],
        ).fetchall()

        for school_id, _, capacity, district_capacity, district_demand in school_rows:
            if not capacity or not district_capacity:
                enrolled = 0
                util_pct = 0.0
            else:
                enrolled = int(round(district_demand * (capacity / district_capacity)))
                util_pct = (enrolled / capacity) * 100

            con.execute(
                """
                INSERT INTO school_utilization (school_id, year, scenario_id, enrolled_estimate, utilization_pct)
                VALUES (?, ?, ?, ?, ?)
                """,
                [school_id, year, scenario, enrolled, util_pct],
            )


def build_recommendations(year, scenario):
    c = fetch_constraints()
    class_size = c["class_size_max"]
    max_distance = c["max_distance_km"]
    min_condition = c["min_condition_score"]

    build_capacity_and_utilization(year, scenario)

    with get_db() as con:
        con.execute("DELETE FROM recommendations WHERE year = ? AND scenario_id = ?", [year, scenario])

        schools = con.execute(
            """
            SELECT
              s.school_id,
              s.district_id,
              s.name,
              s.x_lon,
              s.y_lat,
              s.capacity_total,
              s.condition_score,
              su.enrolled_estimate,
              su.utilization_pct
            FROM schools s
            JOIN school_utilization su
              ON su.school_id = s.school_id
             AND su.year = ?
             AND su.scenario_id = ?
            WHERE s.status = 'active'
            """,
            [year, scenario],
        ).fetchall()

        districts = con.execute(
            """
            SELECT district_id, surplus_deficit, demand_total
            FROM district_capacity
            WHERE year = ? AND scenario_id = ?
            """,
            [year, scenario],
        ).fetchall()

        recs = []

        # Close rule
        for school_id, district_id, name, _, _, capacity, condition, enrolled, util_pct in schools:
            if util_pct < 40 and condition < min_condition:
                recs.append(
                    {
                        "district_id": district_id,
                        "school_id": school_id,
                        "action_type": "close",
                        "reason": f"Låg beläggning ({util_pct:.1f}%) och svagt skick ({condition}).",
                        "impact_students": int(enrolled),
                        "impact_capacity": -int(capacity),
                    }
                )

        # Merge rule
        by_district = {}
        for row in schools:
            by_district.setdefault(row[1], []).append(row)

        for district_id, district_schools in by_district.items():
            for i in range(len(district_schools)):
                a = district_schools[i]
                for j in range(i + 1, len(district_schools)):
                    b = district_schools[j]
                    if a[8] < 55 and b[8] < 55:
                        distance = haversine_km(a[4], a[3], b[4], b[3])
                        if distance < max_distance:
                            recs.append(
                                {
                                    "district_id": district_id,
                                    "school_id": a[0],
                                    "action_type": "merge",
                                    "reason": f"Sammanslagning med {b[2]}: låg beläggning och avstånd {distance:.2f} km.",
                                    "impact_students": int(a[7] + b[7]),
                                    "impact_capacity": -int(min(a[5], b[5]) // 2),
                                }
                            )

        # New build or resize rule
        for district_id, surplus_deficit, demand_total in districts:
            if surplus_deficit < -(class_size * 4):
                recs.append(
                    {
                        "district_id": district_id,
                        "school_id": None,
                        "action_type": "new_build",
                        "reason": f"Kapacitetsunderskott {abs(surplus_deficit)} elever i distriktet.",
                        "impact_students": int(abs(surplus_deficit)),
                        "impact_capacity": int(abs(surplus_deficit)),
                    }
                )
            elif surplus_deficit < -class_size:
                recs.append(
                    {
                        "district_id": district_id,
                        "school_id": None,
                        "action_type": "resize",
                        "reason": f"Mindre underskott {abs(surplus_deficit)} elever i distriktet.",
                        "impact_students": int(abs(surplus_deficit)),
                        "impact_capacity": int(abs(surplus_deficit)),
                    }
                )

        for idx, rec in enumerate(recs, start=1):
            rec_id = f"rec_{year}_{scenario}_{idx}"
            con.execute(
                """
                INSERT INTO recommendations
                  (rec_id, year, scenario_id, district_id, school_id, action_type, reason, impact_students, impact_capacity, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed')
                """,
                [
                    rec_id,
                    year,
                    scenario,
                    rec["district_id"],
                    rec["school_id"],
                    rec["action_type"],
                    rec["reason"],
                    rec["impact_students"],
                    rec["impact_capacity"],
                ],
            )


def table_to_csv(table_name, where_sql="", args=None):
    args = args or []
    sql = f"SELECT * FROM {table_name} {where_sql}"
    rows, columns = query_rows(sql, args)
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(columns)
    for row in rows:
        writer.writerow(row)
    return output.getvalue()


class DemoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def _send_json(self, obj, status=200):
        payload = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError as exc:
            raise ApiError("Invalid JSON body") from exc

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        if not path.startswith("/api/"):
            return super().do_GET()

        try:
            if path == "/api/health":
                return self._send_json({"status": "ok", "time": datetime.utcnow().isoformat() + "Z"})

            if path == "/api/districts":
                data = query_json("SELECT district_id, name, geom_wkt, area_km2 FROM districts ORDER BY district_id")
                return self._send_json(data)

            if path == "/api/schools":
                district_id = as_text(params, "district_id")
                year = as_int(params, "year", 2026)
                sql = (
                    "SELECT school_id, name, district_id, x_lon, y_lat, capacity_total, condition_score, status "
                    "FROM schools WHERE (opened_year IS NULL OR opened_year <= ?) "
                    "AND (closed_year IS NULL OR closed_year >= ?)"
                )
                args = [year, year]
                if district_id:
                    sql += " AND district_id = ?"
                    args.append(district_id)
                sql += " ORDER BY name"
                return self._send_json(query_json(sql, args))

            if path == "/api/forecast":
                scenario = as_text(params, "scenario_id", "base")
                district_id = as_text(params, "district_id")
                sql = (
                    "SELECT district_id, year, scenario_id, expected_students "
                    "FROM forecast WHERE scenario_id = ?"
                )
                args = [scenario]
                if district_id:
                    sql += " AND district_id = ?"
                    args.append(district_id)
                sql += " ORDER BY year, district_id"
                return self._send_json(query_json(sql, args))

            if path == "/api/kpis":
                year = as_int(params, "year", 2026)
                scenario = as_text(params, "scenario_id", "base")
                district_id = as_text(params, "district_id")

                where = "WHERE dc.year = ? AND dc.scenario_id = ?"
                args = [year, scenario]
                if district_id:
                    where += " AND dc.district_id = ?"
                    args.append(district_id)

                sql = f"""
                SELECT
                  COALESCE(SUM(dc.demand_total), 0) AS total_students,
                  COALESCE(SUM(dc.capacity_total), 0) AS total_capacity,
                  COALESCE(SUM(dc.surplus_deficit), 0) AS total_surplus_deficit,
                  CASE WHEN COALESCE(SUM(dc.capacity_total), 0) = 0 THEN 0
                       ELSE ROUND(100.0 * SUM(dc.demand_total) / SUM(dc.capacity_total), 2)
                  END AS utilization_pct
                FROM district_capacity dc
                {where}
                """
                data = query_json(sql, args)
                return self._send_json(data[0])

            if path == "/api/district-capacity":
                year = as_int(params, "year", 2026)
                scenario = as_text(params, "scenario_id", "base")
                return self._send_json(
                    query_json(
                        """
                        SELECT dc.district_id, d.name AS district_name, dc.capacity_total, dc.demand_total, dc.surplus_deficit
                        FROM district_capacity dc
                        JOIN districts d ON d.district_id = dc.district_id
                        WHERE dc.year = ? AND dc.scenario_id = ?
                        ORDER BY dc.district_id
                        """,
                        [year, scenario],
                    )
                )

            if path == "/api/school-utilization":
                year = as_int(params, "year", 2026)
                scenario = as_text(params, "scenario_id", "base")
                district_id = as_text(params, "district_id")
                sql = (
                    "SELECT su.school_id, s.name AS school_name, s.district_id, su.enrolled_estimate, su.utilization_pct "
                    "FROM school_utilization su JOIN schools s ON s.school_id = su.school_id "
                    "WHERE su.year = ? AND su.scenario_id = ?"
                )
                args = [year, scenario]
                if district_id:
                    sql += " AND s.district_id = ?"
                    args.append(district_id)
                sql += " ORDER BY su.utilization_pct DESC"
                return self._send_json(query_json(sql, args))

            if path == "/api/recommendations":
                year = as_int(params, "year", 2026)
                scenario = as_text(params, "scenario_id", "base")
                return self._send_json(
                    query_json(
                        """
                        SELECT r.rec_id, r.year, r.scenario_id, r.district_id, d.name AS district_name,
                               r.school_id, s.name AS school_name, r.action_type, r.reason,
                               r.impact_students, r.impact_capacity, r.status
                        FROM recommendations r
                        LEFT JOIN districts d ON d.district_id = r.district_id
                        LEFT JOIN schools s ON s.school_id = r.school_id
                        WHERE r.year = ? AND r.scenario_id = ?
                        ORDER BY r.rec_id
                        """,
                        [year, scenario],
                    )
                )

            if path == "/api/constraints":
                return self._send_json(fetch_constraints())

            if path == "/api/export":
                dataset = as_text(params, "dataset", "recommendations")
                year = as_int(params, "year", 2026)
                scenario = as_text(params, "scenario_id", "base")

                if dataset not in {"recommendations", "district_capacity", "school_utilization"}:
                    raise ApiError(f"Unsupported export dataset: {dataset}")

                csv_data = table_to_csv(dataset, "WHERE year = ? AND scenario_id = ?", [year, scenario])
                filename = f"{dataset}_{scenario}_{year}.csv"
                body = csv_data.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return

            raise ApiError(f"Unknown endpoint: {path}", 404)

        except ApiError as exc:
            return self._send_json({"error": exc.message}, status=exc.status)
        except Exception as exc:
            return self._send_json({"error": str(exc)}, status=500)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/recommendations/run":
            try:
                body = self._read_json()
                year = int(body.get("year", 2026))
                scenario = body.get("scenario_id", "base")
                build_recommendations(year, scenario)
                return self._send_json({"status": "ok", "year": year, "scenario_id": scenario})
            except ApiError as exc:
                return self._send_json({"error": exc.message}, status=exc.status)
            except Exception as exc:
                return self._send_json({"error": str(exc)}, status=500)

        return self._send_json({"error": "Unknown endpoint"}, status=404)

    def do_PATCH(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/constraints":
            try:
                body = self._read_json()
                class_size = int(body["class_size_max"])
                max_distance_km = float(body["max_distance_km"])
                min_condition = int(body["min_condition_score"])

                with get_db() as con:
                    con.execute(
                        """
                        UPDATE constraints
                           SET class_size_max = ?, max_distance_km = ?, min_condition_score = ?
                         WHERE constraint_id = 'default'
                        """,
                        [class_size, max_distance_km, min_condition],
                    )

                return self._send_json({"status": "ok"})
            except Exception as exc:
                return self._send_json({"error": str(exc)}, status=400)

        return self._send_json({"error": "Unknown endpoint"}, status=404)

    def translate_path(self, path):
        parsed = urlparse(path).path
        clean = posixpath.normpath(parsed)
        words = [w for w in clean.split("/") if w]
        full_path = WEB_DIR
        for word in words:
            if word in (".", ".."):
                continue
            full_path = full_path / word
        return str(full_path)


if __name__ == "__main__":
    host = os.environ.get("HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))

    server = ThreadingHTTPServer((host, port), DemoHandler)
    print(f"Demo server running at http://{host}:{port}")
    server.serve_forever()
