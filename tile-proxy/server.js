const express = require("express");
const cacache = require("cacache");

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const RATE_LIMIT_RPS = Number(process.env.RATE_LIMIT_RPS || 5);
const TTL_DAYS = Number(process.env.CACHE_TTL_DAYS || 30);
const MAX_CACHE_GB = Number(process.env.MAX_CACHE_GB || 2);

const CACHE_DIR = process.env.CACHE_DIR || "./osm_cache";
const UA = process.env.OSM_USER_AGENT || "Gbg-School-Planner/1.0";

const TTL_MS = TTL_DAYS * 24 * 60 * 60 * 1000;
const MAX_CACHE_BYTES = MAX_CACHE_GB * 1024 * 1024 * 1024;

const rateState = new Map();
app.use((req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress || "unknown";
  const now = Date.now();

  let state = rateState.get(ip);
  if (!state || now - state.windowStart >= 1000) {
    state = { windowStart: now, count: 0 };
  }

  state.count += 1;
  rateState.set(ip, state);

  if (state.count > RATE_LIMIT_RPS) {
    return res.status(429).send("Rate limit exceeded");
  }

  next();
});

async function pruneCacheBySize() {
  try {
    const entries = await cacache.ls(CACHE_DIR);
    const items = Object.entries(entries).map(([key, info]) => ({
      key,
      size: info.size || 0,
      time: info.time || 0
    }));

    let total = items.reduce((s, i) => s + i.size, 0);
    if (total <= MAX_CACHE_BYTES) return;

    items.sort((a, b) => a.time - b.time);
    for (const item of items) {
      await cacache.rm.entry(CACHE_DIR, item.key);
      total -= item.size;
      if (total <= MAX_CACHE_BYTES) break;
    }
  } catch (err) {
    console.error("Cache prune error:", err.message);
  }
}

setInterval(pruneCacheBySize, 60 * 60 * 1000);

app.get("/tiles/:z/:x/:y.png", async (req, res) => {
  const { z, x, y } = req.params;
  const key = `${z}/${x}/${y}`;

  try {
    const info = await cacache.get.info(CACHE_DIR, key);
    if (info && Date.now() - info.time <= TTL_MS) {
      const cached = await cacache.get(CACHE_DIR, key);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("X-Cache-Status", "HIT");
      return res.send(cached.data);
    } else if (info) {
      await cacache.rm.entry(CACHE_DIR, key);
    }
  } catch {
    // cache miss
  }

  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const response = await fetch(url, { headers: { "User-Agent": UA } });

  if (!response.ok) {
    return res.status(response.status).send("Tile fetch failed");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await cacache.put(CACHE_DIR, key, buffer);

  res.setHeader("Content-Type", "image/png");
  res.setHeader("X-Cache-Status", "MISS");
  res.send(buffer);
});

app.listen(PORT, () => {
  console.log(`OSM tile proxy on http://localhost:${PORT}/tiles/{z}/{x}/{y}.png`);
});
