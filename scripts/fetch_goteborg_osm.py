#!/usr/bin/env python3
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "map-data" / "raw"
RAW_DIR.mkdir(parents=True, exist_ok=True)

# Gothenburg bounding box: south,west,north,east
BBOX = "57.60,11.80,57.78,12.08"
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.fr/api/interpreter",
]

QUERY = f"""
[out:json][timeout:90];
(
  way["highway"]({BBOX});
  way["waterway"]({BBOX});
  way["natural"="water"]({BBOX});
  way["landuse"="forest"]({BBOX});
  way["leisure"="park"]({BBOX});
  way["building"]({BBOX});
);
out geom;
"""


def is_closed(coords):
    return len(coords) > 3 and coords[0] == coords[-1]


def to_feature(element, geometry_type, layer_name):
    coords = [[pt["lon"], pt["lat"]] for pt in element.get("geometry", [])]
    if not coords:
        return None

    if geometry_type == "Polygon":
        if not is_closed(coords):
            return None
        geom = {"type": "Polygon", "coordinates": [coords]}
    else:
        geom = {"type": "LineString", "coordinates": coords}

    return {
        "type": "Feature",
        "properties": {
            "id": element.get("id"),
            "layer": layer_name,
            **element.get("tags", {}),
        },
        "geometry": geom,
    }


def layer_for(tags):
    if "highway" in tags:
        return "roads", "LineString"
    if tags.get("waterway") or tags.get("natural") == "water":
        if tags.get("waterway"):
            return "water_lines", "LineString"
        return "water_polygons", "Polygon"
    if tags.get("building"):
        return "buildings", "Polygon"
    if tags.get("landuse") == "forest" or tags.get("leisure") == "park":
        return "green_areas", "Polygon"
    return None, None


def main():
    payload = None
    last_error = None
    for url in OVERPASS_URLS:
        for attempt in range(1, 4):
            req = urllib.request.Request(
                url,
                data=urllib.parse.urlencode({"data": QUERY}).encode("utf-8"),
                method="POST",
                headers={"User-Agent": "school-planning-poc/1.0"},
            )
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                    print(f"Fetched OSM data from {url} (attempt {attempt})")
                    break
            except (HTTPError, URLError, TimeoutError) as exc:
                last_error = exc
                print(f"Fetch failed from {url} (attempt {attempt}): {exc}")
                time.sleep(2 * attempt)
        if payload is not None:
            break

    if payload is None:
        raise SystemExit(f"All Overpass endpoints failed. Last error: {last_error}")

    layers = {
        "roads": [],
        "water_lines": [],
        "water_polygons": [],
        "green_areas": [],
        "buildings": [],
    }

    for element in payload.get("elements", []):
        tags = element.get("tags", {})
        layer_name, geom_type = layer_for(tags)
        if not layer_name:
            continue
        feature = to_feature(element, geom_type, layer_name)
        if feature:
            layers[layer_name].append(feature)

    for layer_name, features in layers.items():
        geojson = {"type": "FeatureCollection", "features": features}
        path = RAW_DIR / f"{layer_name}.geojson"
        path.write_text(json.dumps(geojson), encoding="utf-8")
        print(f"Wrote {path} ({len(features)} features)")


if __name__ == "__main__":
    main()
