const state = {
  year: 2026,
  scenario: "base",
  forecastChart: null,
  map: null,
  mapLoaded: false,
  demoStep: 0
};

const SCENARIO_LABELS = {
  base: "Bas",
  low: "Låg",
  high: "Hög"
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

function goToTab(tabName) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
  const tabBtn = document.querySelector(`.tab[data-tab="${tabName}"]`);
  if (tabBtn) {
    tabBtn.classList.add("active");
  }
  const panel = qs(tabName);
  if (panel) {
    panel.classList.add("active");
  }
  if (tabName === "map" && state.map) {
    setTimeout(() => state.map.resize(), 0);
  }
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      goToTab(btn.dataset.tab);
    });
  });
}

function setupDemoGuide() {
  const steps = [
    {
      tab: "overview",
      title: "Steg 1: Nuläge och kapacitetsbalans",
      text: "Visa hur många elever som förväntas i år och vilka distrikt som har störst underskott."
    },
    {
      tab: "forecast",
      title: "Steg 2: Prognos och scenarier",
      text: "Jämför Bas, Låg och Hög för att visa osäkerhet och konsekvenser."
    },
    {
      tab: "map",
      title: "Steg 3: Geografisk påverkan",
      text: "Peka ut var skolor och distrikt ligger för att förankra beslut i geografi."
    },
    {
      tab: "planning",
      title: "Steg 4: Proaktiva åtgärder",
      text: "Gå igenom förslag med tilltro-badge och tydlig motivering."
    },
    {
      tab: "export",
      title: "Steg 5: Beslutsunderlag",
      text: "Exportera samma underlag till Excel för beslut och dokumentation."
    }
  ];

  function applyStep() {
    const current = steps[state.demoStep];
    qs("demoStepTitle").textContent = current.title;
    qs("demoStepText").textContent = current.text;
    goToTab(current.tab);
    qs("demoNextBtn").textContent = state.demoStep === steps.length - 1 ? "Börja om demo" : "Nästa steg";
  }

  qs("demoNextBtn").addEventListener("click", () => {
    state.demoStep = (state.demoStep + 1) % steps.length;
    applyStep();
  });

  applyStep();
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

  const forecastRes = await api(`/api/forecast?scenario_id=${state.scenario}`);
  const forecastRows = await forecastRes.json();
  const totalByYear = {};
  forecastRows.forEach((row) => {
    totalByYear[row.year] = (totalByYear[row.year] || 0) + row.expected_students;
  });
  const now = totalByYear[2026] || 0;
  const end = totalByYear[2036] || 0;
  const delta = now === 0 ? 0 : (((end - now) / now) * 100);
  qs("insightDemandChange").textContent = `${formatNum(end)} elever (${delta.toFixed(1)}% mot 2026)`;

  const sortedByDeficit = [...districts].sort((a, b) => a.surplus_deficit - b.surplus_deficit);
  const topRisk = sortedByDeficit[0];
  qs("insightRiskDistrict").textContent = topRisk
    ? `${topRisk.district_name} (${formatNum(topRisk.surplus_deficit)})`
    : "Inga riskdistrikt";

  if (topRisk && topRisk.surplus_deficit < 0) {
    qs("insightAction").textContent = "Prioritera proaktiv kapacitetsökning i distrikt med underskott.";
  } else {
    qs("insightAction").textContent = "Nuvarande kapacitet räcker för valt år.";
  }

  const spotlightList = qs("spotlightList");
  spotlightList.innerHTML = "";
  sortedByDeficit.slice(0, 3).forEach((d) => {
    const li = document.createElement("li");
    li.textContent = `${d.district_name}: balans ${formatNum(d.surplus_deficit)} (kapacitet ${formatNum(d.capacity_total)} / efterfrågan ${formatNum(d.demand_total)})`;
    spotlightList.appendChild(li);
  });
}

async function refreshForecast() {
  const [baseRes, lowRes, highRes] = await Promise.all([
    api("/api/forecast?scenario_id=base"),
    api("/api/forecast?scenario_id=low"),
    api("/api/forecast?scenario_id=high")
  ]);
  const [baseRows, lowRows, highRows] = await Promise.all([baseRes.json(), lowRes.json(), highRes.json()]);
  const scenarioRows = { base: baseRows, low: lowRows, high: highRows };

  const totalsPerScenario = {};
  Object.keys(scenarioRows).forEach((scenarioId) => {
    const totals = {};
    scenarioRows[scenarioId].forEach((r) => {
      totals[r.year] = (totals[r.year] || 0) + r.expected_students;
    });
    totalsPerScenario[scenarioId] = totals;
  });

  const labels = Object.keys(totalsPerScenario.base || {})
    .map((x) => Number(x))
    .sort((a, b) => a - b);

  if (state.forecastChart) {
    state.forecastChart.destroy();
  }

  const configByScenario = {
    base: { color: "#0b6bcb", bg: "rgba(11, 107, 203, 0.14)" },
    low: { color: "#475569", bg: "rgba(71, 85, 105, 0.10)" },
    high: { color: "#ea580c", bg: "rgba(234, 88, 12, 0.10)" }
  };

  state.forecastChart = new Chart(qs("forecastChart"), {
    type: "line",
    data: {
      labels,
      datasets: ["base", "low", "high"].map((scenarioId) => {
        const selected = scenarioId === state.scenario;
        return {
          label: `Elevprognos (${SCENARIO_LABELS[scenarioId]})`,
          data: labels.map((year) => totalsPerScenario[scenarioId][year] || 0),
          fill: selected,
          borderColor: configByScenario[scenarioId].color,
          backgroundColor: configByScenario[scenarioId].bg,
          pointRadius: selected ? 3 : 2,
          pointHoverRadius: 4,
          borderWidth: selected ? 3 : 2,
          borderDash: selected ? [] : [6, 4],
          tension: 0.25
        };
      })
    },
    options: {
      plugins: {
        legend: {
          labels: {
            color: "#2a3d4f",
            font: { family: "Newsreader, serif", size: 13 }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: "#385061" },
          grid: { color: "rgba(56,80,97,0.12)" }
        },
        y: {
          ticks: { color: "#385061" },
          grid: { color: "rgba(56,80,97,0.12)" }
        }
      }
    }
  });

  const compareBody = qs("forecastCompareBody");
  compareBody.innerHTML = "";
  ["base", "low", "high"].forEach((scenarioId) => {
    const start = totalsPerScenario[scenarioId][2026] || 0;
    const end = totalsPerScenario[scenarioId][2036] || 0;
    const pct = start === 0 ? 0 : (((end - start) / start) * 100);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${SCENARIO_LABELS[scenarioId]}</td>
      <td>${formatNum(end)}</td>
      <td>${pct.toFixed(1)}%</td>
    `;
    compareBody.appendChild(tr);
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
  const dRes = await api(`/api/map/district-balance?${currentQuery()}`);
  const districtData = await dRes.json();
  const sRes = await api(`/api/schools?year=${state.year}`);
  const schools = await sRes.json();

  const districtFeatures = districtData.features || [];

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
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol("pmtiles", protocol.tile);
    const hasPmtiles = await fetch("/tiles/goteborg.pmtiles", { method: "HEAD" })
      .then((res) => res.ok)
      .catch(() => false);

    const baseStyle = hasPmtiles
      ? {
          version: 8,
          glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
          sources: {
            goteborg: {
              type: "vector",
              url: "pmtiles:///tiles/goteborg.pmtiles"
            }
          },
          layers: [
            {
              id: "green-areas",
              source: "goteborg",
              "source-layer": "green_areas",
              type: "fill",
              paint: { "fill-color": "#dbeed9", "fill-opacity": 0.85 }
            },
            {
              id: "water-polygons",
              source: "goteborg",
              "source-layer": "water_polygons",
              type: "fill",
              paint: { "fill-color": "#c8e4ff", "fill-opacity": 0.95 }
            },
            {
              id: "water-lines",
              source: "goteborg",
              "source-layer": "water_lines",
              type: "line",
              paint: { "line-color": "#8fbef3", "line-width": 1.2 }
            },
            {
              id: "buildings",
              source: "goteborg",
              "source-layer": "buildings",
              type: "fill",
              paint: { "fill-color": "#ece6da", "fill-opacity": 0.72 }
            },
            {
              id: "road-casing",
              source: "goteborg",
              "source-layer": "roads",
              type: "line",
              paint: {
                "line-color": "#d4d9df",
                "line-width": [
                  "match",
                  ["get", "highway"],
                  "motorway",
                  3.8,
                  "trunk",
                  3.4,
                  "primary",
                  3.0,
                  "secondary",
                  2.4,
                  1.6
                ]
              }
            },
            {
              id: "roads",
              source: "goteborg",
              "source-layer": "roads",
              type: "line",
              paint: {
                "line-color": "#ffffff",
                "line-width": [
                  "match",
                  ["get", "highway"],
                  "motorway",
                  2.8,
                  "trunk",
                  2.5,
                  "primary",
                  2.1,
                  "secondary",
                  1.6,
                  1.1
                ]
              }
            },
            {
              id: "road-labels",
              source: "goteborg",
              "source-layer": "roads",
              type: "symbol",
              minzoom: 12,
              layout: {
                "symbol-placement": "line",
                "text-field": ["coalesce", ["get", "name"], ""],
                "text-font": ["Noto Sans Regular"],
                "text-size": 11
              },
              paint: {
                "text-color": "#5e6d7b",
                "text-halo-color": "#ffffff",
                "text-halo-width": 1.1
              }
            }
          ]
        }
      : {
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
        };

    state.map = new maplibregl.Map({
      container: "mapView",
      style: baseStyle,
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
          "fill-color": [
            "step",
            ["get", "surplus_deficit"],
            "#fca5a5",
            -150,
            "#fecaca",
            -50,
            "#ffedd5",
            0,
            "#d1fae5",
            80,
            "#86efac"
          ],
          "fill-opacity": 0.46
        }
      });

      state.map.addLayer({
        id: "district-line",
        type: "line",
        source: "districts",
        paint: {
          "line-color": "#0f3f67",
          "line-width": 1.8
        }
      });

      state.map.addLayer({
        id: "district-label",
        type: "symbol",
        source: "districts",
        layout: {
          "text-field": ["get", "district_name"],
          "text-size": 12,
          "text-font": ["Noto Sans Regular"]
        },
        paint: {
          "text-color": "#0f2940",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.2
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
          "circle-radius": ["interpolate", ["linear"], ["get", "capacity"], 200, 4, 600, 8],
          "circle-color": "#f59e0b",
          "circle-opacity": 0.9,
          "circle-stroke-width": 1.2,
          "circle-stroke-color": "#ffffff"
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

      state.map.on("click", "district-fill", (e) => {
        const p = e.features[0].properties;
        new maplibregl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(
            `<strong>${p.district_name}</strong><br/>Kapacitet: ${p.capacity_total}<br/>Efterfrågan: ${p.demand_total}<br/>Balans: ${p.surplus_deficit}`
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

  function confidenceFor(rec) {
    let score = 0;
    const impact = Math.abs(rec.impact_students || 0);
    if (impact >= 200) score += 2;
    else if (impact >= 100) score += 1;
    if (rec.action_type === "new_build" || rec.action_type === "resize") score += 1;
    if ((rec.reason || "").toLowerCase().includes("underskott")) score += 1;
    if (score >= 3) return { label: "Hög", className: "conf-high" };
    if (score >= 2) return { label: "Medel", className: "conf-medium" };
    return { label: "Låg", className: "conf-low" };
  }

  recs.forEach((r) => {
    const confidence = confidenceFor(r);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><span class="action-pill">${r.action_type}</span></td>
      <td><span class="confidence-pill ${confidence.className}">${confidence.label}</span></td>
      <td>${r.district_name || "-"}</td>
      <td>${r.school_name || "-"}</td>
      <td>${formatNum(r.impact_students)}</td>
      <td>${formatNum(r.impact_capacity)}</td>
      <td>${r.reason}</td>
    `;
    tbody.appendChild(tr);
  });

  const highConfidence = recs.filter((r) => confidenceFor(r).label === "Hög").length;
  const proactive = recs.filter((r) => r.action_type === "new_build" || r.action_type === "resize").length;
  const proactiveShare = recs.length ? ((proactive / recs.length) * 100).toFixed(0) : "0";
  qs("recTotalCount").textContent = formatNum(recs.length);
  qs("recHighConfidence").textContent = formatNum(highConfidence);
  qs("recProactiveShare").textContent = `${proactiveShare}%`;
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
  setupDemoGuide();
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
