CREATE TABLE districts (
  district_id        TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  geom_wkt           TEXT,
  area_km2           DOUBLE
);

CREATE TABLE schools (
  school_id          TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  district_id        TEXT REFERENCES districts(district_id),
  x_lon              DOUBLE,
  y_lat              DOUBLE,
  capacity_total     INTEGER,
  condition_score    INTEGER,
  status             TEXT,
  opened_year        INTEGER,
  closed_year        INTEGER
);

CREATE TABLE students (
  student_id         TEXT,
  age                INTEGER,
  year               INTEGER,
  district_id        TEXT REFERENCES districts(district_id),
  x_lon              DOUBLE,
  y_lat              DOUBLE,
  PRIMARY KEY (student_id, year)
);

CREATE TABLE scenarios (
  scenario_id        TEXT PRIMARY KEY,
  name               TEXT NOT NULL
);

CREATE TABLE forecast (
  district_id        TEXT REFERENCES districts(district_id),
  year               INTEGER,
  scenario_id        TEXT REFERENCES scenarios(scenario_id),
  expected_students  INTEGER,
  PRIMARY KEY (district_id, year, scenario_id)
);

CREATE TABLE constraints (
  constraint_id      TEXT PRIMARY KEY,
  class_size_max     INTEGER,
  max_distance_km    DOUBLE,
  min_condition_score INTEGER
);

CREATE TABLE district_capacity (
  district_id        TEXT REFERENCES districts(district_id),
  year               INTEGER,
  scenario_id        TEXT REFERENCES scenarios(scenario_id),
  capacity_total     INTEGER,
  demand_total       INTEGER,
  surplus_deficit    INTEGER,
  PRIMARY KEY (district_id, year, scenario_id)
);

CREATE TABLE school_utilization (
  school_id          TEXT REFERENCES schools(school_id),
  year               INTEGER,
  scenario_id        TEXT REFERENCES scenarios(scenario_id),
  enrolled_estimate  INTEGER,
  utilization_pct    DOUBLE,
  PRIMARY KEY (school_id, year, scenario_id)
);

CREATE TABLE recommendations (
  rec_id             TEXT PRIMARY KEY,
  year               INTEGER,
  scenario_id        TEXT REFERENCES scenarios(scenario_id),
  district_id        TEXT REFERENCES districts(district_id),
  school_id          TEXT REFERENCES schools(school_id),
  action_type        TEXT,
  reason             TEXT,
  impact_students    INTEGER,
  impact_capacity    INTEGER,
  status             TEXT
);

CREATE TABLE users (
  user_id            TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  email              TEXT UNIQUE,
  role               TEXT,
  password_hash      TEXT,
  active             BOOLEAN DEFAULT TRUE
);
