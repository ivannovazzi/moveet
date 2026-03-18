# @moveet/network

CLI pipeline that downloads OSM road data from Geofabrik, extracts a city bounding box, filters to driveable road classes, and exports a GeoJSON file ready for the simulator.

## Prerequisites

Install [osmium-tool](https://osmcode.org/osmium-tool/):

```bash
# macOS
brew install osmium-tool

# Ubuntu / Debian
sudo apt install osmium-tool
```

Docker is no longer required — the CLI uses the local `osmium` binary directly.

## Quick start

```bash
# From the monorepo root:
npx tsx apps/network/src/cli.ts prepare cairo

# Or from apps/network/:
npx tsx src/cli.ts prepare cairo
```

This runs the full pipeline and writes the result to `apps/simulator/export.geojson`.

## Built-in regions

| Region key    | City                  |
|---------------|-----------------------|
| `nairobi`     | Nairobi, Kenya        |
| `cairo`       | Cairo, Egypt          |
| `lagos`       | Lagos, Nigeria        |
| `london`      | London, UK            |
| `berlin`      | Berlin, Germany       |
| `paris`       | Paris, France         |
| `mumbai`      | Mumbai, India         |
| `jakarta`     | Jakarta, Indonesia    |
| `mexico-city` | Mexico City, Mexico   |
| `new-york`    | New York, USA         |

```bash
npx tsx src/cli.ts prepare nairobi
npx tsx src/cli.ts prepare new-york
```

## Custom bounding box

```bash
npx tsx src/cli.ts prepare \
  --geofabrik africa/kenya \
  --bbox 36.70,-1.35,36.95,-1.20 \
  --output apps/simulator/export.geojson
```

`--bbox` format: `west,south,east,north` (decimal degrees).
`--geofabrik` is the Geofabrik path, e.g. `europe/germany`, `north-america/us/new-york`.

## Custom output path

```bash
npx tsx src/cli.ts prepare cairo --output /tmp/cairo.geojson
```

## Pipeline steps

The `prepare` command chains four steps. You can also run them individually:

```bash
# 1. Download country PBF (cached by ETag)
npx tsx src/cli.ts download --region cairo

# 2. Extract city bounding box
npx tsx src/cli.ts extract \
  --input .cache/africa-egypt-latest.osm.pbf \
  --output .cache/cairo.osm.pbf \
  --bbox 31.1,29.9,31.7,30.2

# 3. Filter to driveable road classes
npx tsx src/cli.ts filter \
  --input .cache/cairo.osm.pbf \
  --output .cache/cairo-roads.osm.pbf

# 4. Export to GeoJSON
npx tsx src/cli.ts export \
  --input .cache/cairo-roads.osm.pbf \
  --output apps/simulator/export.geojson \
  --region cairo

# 5. Validate topology
npx tsx src/cli.ts validate --input apps/simulator/export.geojson
```

## Caching

Downloaded PBF files are stored in `apps/network/.cache/` and reused on subsequent runs (compared by ETag). Use `--force` to re-download even when a cached file exists.

## Road classes included

`motorway`, `motorway_link`, `trunk`, `trunk_link`, `primary`, `primary_link`, `secondary`, `secondary_link`, `tertiary`, `tertiary_link`, `unclassified`, `residential`, `living_street`, plus `junction=roundabout`.

## Validation thresholds

The `validate` command passes when:
- ≥ 95% of nodes are in the largest connected component
- < 5% of nodes are isolated (degree 0)

Real-world city exports always include small disconnected fragments at bounding-box boundaries; a strict component-count limit would reject valid networks.
