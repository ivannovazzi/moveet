# Network CLI — Design Document

**Date:** 2026-03-18
**Status:** Approved
**App:** `apps/network` (`@moveet/network`)

---

## Problem

The Moveet simulator loads a static GeoJSON road network exported manually from Overpass Turbo, frozen at a single point in time. There is no automated way to download, prepare, or refresh road network data for any city globally. Every new city or data update requires manual intervention.

## Solution

A standalone Node.js CLI tool (`apps/network`) that handles the full pipeline from raw OSM data to a validated GeoJSON network file ready for the simulator. osmium runs in Docker — no binary install required.

---

## Architecture

```
apps/network/
├── src/
│   ├── commands/
│   │   ├── download.ts     # fetch PBF from Geofabrik
│   │   ├── extract.ts      # osmium extract bbox
│   │   ├── filter.ts       # osmium tags-filter road classes
│   │   ├── export.ts       # osmium export → GeoJSON
│   │   ├── validate.ts     # topology checks
│   │   ├── diff.ts         # compare two GeoJSON versions
│   │   └── prepare.ts      # interactive wizard (orchestrates all)
│   ├── docker.ts           # docker run osmium wrapper
│   ├── regions.ts          # manifest loader + bbox lookup
│   └── cli.ts              # Commander.js entry point
├── regions.json            # pre-defined cities (extensible)
├── package.json
└── tsconfig.json
```

**Tech stack:** TypeScript, Commander.js (CLI), Inquirer.js (wizard prompts), Zod (config validation), pino (logging), tsx (dev), tsc (build).

---

## Pipeline

Every region runs the same 5 steps in sequence:

```
1. download  →  {region}-latest.osm.pbf        (Geofabrik, cached by ETag)
2. extract   →  {region}.osm.pbf               (osmium bbox crop)
3. filter    →  {region}-roads.osm.pbf         (road classes only)
4. export    →  {region}-roads.geojson         (osmium → GeoJSON)
5. validate  →  stdout report + exit code      (connectivity, isolated nodes)
```

Intermediate files are cached in `apps/network/.cache/` (gitignored). Re-runs skip steps whose input hash is unchanged.

---

## Commands

### Individual (composable in CI)

```bash
network download nairobi
network download --bbox 36.65,-1.45,37.10,-1.15 --geofabrik africa/kenya

network extract --region nairobi
network filter  --input .cache/nairobi.osm.pbf
network export  --input .cache/nairobi-roads.osm.pbf \
                --output apps/simulator/data/network.geojson

network validate --input apps/simulator/data/network.geojson

network diff old.geojson new.geojson
```

### Wizard (top-level)

```bash
network prepare             # interactive: prompts for region + options
network prepare nairobi     # non-interactive, uses defaults, CI-safe
```

Non-interactive mode exits with code 1 on validation failure.

---

## Regions Manifest (`regions.json`)

```json
{
  "nairobi": {
    "bbox": [36.65, -1.45, 37.10, -1.15],
    "geofabrik": "africa/kenya",
    "label": "Nairobi, Kenya"
  },
  "lagos": {
    "bbox": [3.08, 6.35, 3.75, 6.85],
    "geofabrik": "africa/nigeria",
    "label": "Lagos, Nigeria"
  },
  "cairo": {
    "bbox": [31.1, 29.9, 31.7, 30.2],
    "geofabrik": "africa/egypt",
    "label": "Cairo, Egypt"
  },
  "london": {
    "bbox": [-0.51, 51.28, 0.33, 51.69],
    "geofabrik": "europe/great-britain",
    "label": "London, UK"
  }
}
```

`bbox` format: `[west, south, east, north]`. Unknown regions accepted via `--bbox` + `--geofabrik` flags — any city on earth works without a manifest entry.

---

## Docker osmium Wrapper

```typescript
// src/docker.ts
import { execSync } from "child_process";
import path from "path";

export function osmium(args: string[], workdir: string): void {
  const vol = `${path.resolve(workdir)}:/data`;
  execSync(
    `docker run --rm -v ${vol} ghcr.io/osmcode/osmium-tool osmium ${args.join(" ")}`,
    { stdio: "inherit" }
  );
}
```

All file paths passed to osmium are relative to `/data` inside the container. No path translation needed beyond mounting `workdir`.

---

## `prepare` Wizard UX

```
? Region name or bbox? (type to search, or enter custom bbox)
  ❯ nairobi — Nairobi, Kenya
    lagos   — Lagos, Nigeria
    cairo   — Cairo, Egypt
    london  — London, UK
    [enter custom bbox]

? Output path? (apps/simulator/data/network.geojson)

? Road classes to include?
  ✔ motorway + links
  ✔ trunk + links
  ✔ primary + links
  ✔ secondary + links
  ✔ tertiary + links
  ✔ unclassified
  ✔ residential
  ○ service (alley/bus_bay)

Downloading africa/kenya-latest.osm.pbf ...  ████████░░  82%
Extracting bbox ...                           ✔  done  (0.4s)
Filtering road classes ...                    ✔  done  (0.2s)
Exporting GeoJSON ...                         ✔  done  (1.1s)
Validating topology ...                       ✔  18,432 nodes · 2 components · 0 isolated
```

---

## `diff` Output

```
Road Network Diff: v2025-01-15 → v2026-03-18
─────────────────────────────────────────────
Nodes        +1,204  added    │   -87  removed
Edges        +2,108  added    │  -143  removed
Speed limits    +34  changed
One-way          +9  newly restricted

New roads:   Ngong Road extension (tertiary, 2.3km)
Removed:     Old Mombasa Road spur (unclassified)
```

Exit code 0 = identical, 1 = changed. Usable as a CI gate.

---

## Cache Layout

```
apps/network/.cache/
├── africa-kenya-latest.osm.pbf        # Geofabrik download
├── africa-kenya-latest.osm.pbf.etag   # HTTP ETag for freshness check
├── nairobi.osm.pbf                    # extracted bbox
└── nairobi-roads.osm.pbf              # filtered road classes
```

`.cache/` is gitignored. Only the final GeoJSON written to `--output` is committed.

---

## Output Default

`--output` defaults to `apps/simulator/data/network.geojson` — zero config for the common case. Configurable for any other consumer.
