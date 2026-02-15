# OSM Tile Proxy (Local)

## Install
```bash
npm install
```

## Run
```bash
npm start
```

## MapLibre tile URL
```
http://localhost:8080/tiles/{z}/{x}/{y}.png
```

## Defaults
- Rate limit: 5 req/s per IP
- Cache TTL: 30 days
- Max cache size: 2 GB

Override via env vars:
- `RATE_LIMIT_RPS`
- `CACHE_TTL_DAYS`
- `MAX_CACHE_GB`
- `CACHE_DIR`
- `OSM_USER_AGENT`
