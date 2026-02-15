const state = {
  year: 2026,
  scenario: "base",
  forecastChart: null,
  map: null,
  mapLoaded: false
};

function qs(id) {
  return document.getElementById(id);
}

function formatNum(value) {
  return new Intl.NumberFormat("sv-SE").format(value ?? 0);
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `HTTP ${res.status}`);
  }
  return res;
}

function currentQuery() {
  const params = new URLSearchParams({
    year: String(state.year),
    scenario_id: state.scenario
  });
  return params.toString();
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      qs(btn.dataset.tab).classList.add("active");
      if (btn.dataset.tab === "map" && state.map) {
        setTimeout(() => state.map.resize(), 0);
      }
    });
  });
}

function setupFilters() {
  const yearSelect = qs("yearSelect");
  for (let y = 2026; y <= 2036; y += 1) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
  yearSelect.value = String(state.year);

  yearSelect.addEventListener("change", async (e) => {
    state.year = Number(e.target.value);
    await refreshAll();
  });

  qs("scenarioSelect").addEventListener("change", async (e) => {
    state.scenario = e.target.value;
    await refreshAll();
  });

  qs("runPlanningBtn").addEventListener("click", async () => {
    await api("/api/recommendations/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ year: state.year, scenario_id: state.scenario })
    });
    await refreshPlanning();
  });
}

async function refreshOverview() {
  const kpiRes = await api(`/api/kpis?${currentQuery()}`);
  const kpi = await kpiRes.json();

  qs("kpiStudents").textContent = formatNum(kpi.total_students);
  qs("kpiCapacity").textContent = formatNum(kpi.total_capacity);
  qs("kpiUtilization").textContent = `${kpi.utilization_pct ?? 0}%`;

  const bal = kpi.total_surplus_deficit || 0;
  qs("kpiSurplus").textContent = formatNum(bal);
  qs("kpiSurplus").className = bal < 0 ? "neg" : "pos";

  const districtRes = await api(`/api/district-capacity?${currentQuery()}`);
  const districts = await districtRes.json();
  const tbody = qs("districtTable").querySelector("tbody");
  tbody.innerHTML = "";

  districts.forEach((d) => {
    const tr = document.createElement("tr");
    const cls = d.surplus_deficit < 0 ? "neg" : "pos";
    tr.innerHTML = `
      <td>${d.district_name}</td>
      <td>${formatNum(d.capacity_total)}</td>
      <td>${formatNum(d.demand_total)}</td>
      <td class="${cls}">${formatNum(d.surplus_deficit)}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function refreshForecast() {
  const res = await api(`/api/forecast?scenario_id=${state.scenario}`);
  const rows = await res.json();

  const totalsByYear = {};
  rows.forEach((r) => {
    totalsByYear[r.year] = (totalsByYear[r.year] || 0) + r.expected_students;
  });

  const labels = Object.keys(totalsByYear)
    .map((x) => Number(x))
    .sort((a, b) => a - b);
  const data = labels.map((year) => totalsByYear[year]);

  if (state.forecastChart) {
    state.forecastChart.destroy();
  }

  state.forecastChart = new Chart(qs("forecastChart"), {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `Elevprognos (${state.scenario})`,
          data,
          fill: true,
          borderColor: "#005f73",
          backgroundColor: "rgba(0,95,115,0.15)",
          tension: 0.2
        }
      ]
    }
  });
}

function parseWktPolygon(wkt) {
  const inside = wkt.replace("POLYGON((", "").replace("))", "");
  return inside.split(",").map((pair) => {
    const [lon, lat] = pair.trim().split(" ").map(Number);
    return [lon, lat];
  });
}

async function refreshMap() {
  const dRes = await api("/api/districts");
  const districts = await dRes.json();
  const sRes = await api(`/api/schools?year=${state.year}`);
  const schools = await sRes.json();

  const districtFeatures = districts.map((d) => ({
    type: "Feature",
    properties: { district_id: d.district_id, name: d.name },
    geometry: {
      type: "Polygon",
      coordinates: [parseWktPolygon(d.geom_wkt)]
    }
  }));

  const schoolFeatures = schools.map((s) => ({
    type: "Feature",
    properties: {
      name: s.name,
      district_id: s.district_id,
      capacity: s.capacity_total,
      condition_score: s.condition_score
    },
    geometry: {
      type: "Point",
      coordinates: [s.x_lon, s.y_lat]
    }
  }));

  if (!state.map) {
    state.map = new maplibregl.Map({
      container: "mapView",
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [
              "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png"
            ],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors"
          }
        },
        layers: [{ id: "osm", type: "raster", source: "osm" }]
      },
      center: [11.95, 57.71],
      zoom: 11
    });

    state.map.on("load", () => {
      state.mapLoaded = true;
      state.map.addSource("districts", {
        type: "geojson",
        data: { type: "FeatureCollection", features: districtFeatures }
      });

      state.map.addLayer({
        id: "district-fill",
        type: "fill",
        source: "districts",
        paint: {
          "fill-color": "#0a9396",
          "fill-opacity": 0.2
        }
      });

      state.map.addLayer({
        id: "district-line",
        type: "line",
        source: "districts",
        paint: {
          "line-color": "#005f73",
          "line-width": 2
        }
      });

      state.map.addSource("schools", {
        type: "geojson",
        data: { type: "FeatureCollection", features: schoolFeatures }
      });

      state.map.addLayer({
        id: "school-points",
        type: "circle",
        source: "schools",
        paint: {
          "circle-radius": 6,
          "circle-color": "#ca6702",
          "circle-stroke-width": 1,
          "circle-stroke-color": "#fff"
        }
      });

      state.map.on("click", "school-points", (e) => {
        const p = e.features[0].properties;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${p.name}</strong><br/>Kapacitet: ${p.capacity}<br/>Byggnadsskick: ${p.condition_score}`
          )
          .addTo(state.map);
      });

      const bounds = new maplibregl.LngLatBounds();
      districtFeatures.forEach((feature) => {
        feature.geometry.coordinates[0].forEach((coord) => bounds.extend(coord));
      });
      if (!bounds.isEmpty()) {
        state.map.fitBounds(bounds, { padding: 40, duration: 0 });
      }
      state.map.resize();
    });

    state.map.on("error", (event) => {
      // Keep diagnostics in console for demo debugging without crashing UI.
      console.error("Map error:", event && event.error ? event.error.message : event);
    });
  } else {
    if (state.mapLoaded) {
      const dSource = state.map.getSource("districts");
      if (dSource) {
        dSource.setData({ type: "FeatureCollection", features: districtFeatures });
      }
      const sSource = state.map.getSource("schools");
      if (sSource) {
        sSource.setData({ type: "FeatureCollection", features: schoolFeatures });
      }
    }
  }
}

async function refreshPlanning() {
  const constraintsRes = await api("/api/constraints");
  const constraints = await constraintsRes.json();

  qs("classSize").value = constraints.class_size_max;
  qs("maxDistance").value = constraints.max_distance_km;
  qs("minCondition").value = constraints.min_condition_score;

  const recRes = await api(`/api/recommendations?${currentQuery()}`);
  const recs = await recRes.json();
  const tbody = qs("recsTable").querySelector("tbody");
  tbody.innerHTML = "";

  recs.forEach((r) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${r.action_type}</td>
      <td>${r.district_name || "-"}</td>
      <td>${r.school_name || "-"}</td>
      <td>${formatNum(r.impact_students)}</td>
      <td>${formatNum(r.impact_capacity)}</td>
      <td>${r.reason}</td>
    `;
    tbody.appendChild(tr);
  });
}

function setupConstraintsSave() {
  qs("saveConstraintsBtn").addEventListener("click", async () => {
    await api("/api/constraints", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        class_size_max: Number(qs("classSize").value),
        max_distance_km: Number(qs("maxDistance").value),
        min_condition_score: Number(qs("minCondition").value)
      })
    });
    await refreshPlanning();
  });
}

function setupExport() {
  document.querySelectorAll("[data-export]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const dataset = btn.dataset.export;
      const url = `/api/export?dataset=${dataset}&${currentQuery()}`;
      window.location.href = url;
    });
  });
}

async function refreshAll() {
  await Promise.all([refreshOverview(), refreshForecast(), refreshPlanning(), refreshMap()]);
}

async function init() {
  setupTabs();
  setupFilters();
  setupConstraintsSave();
  setupExport();

  await api("/api/recommendations/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year: state.year, scenario_id: state.scenario })
  });

  await refreshAll();
}

init().catch((err) => {
  console.error(err);
  alert(`Fel: ${err.message}`);
});
