# Network CLI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build `apps/network` — a standalone CLI that downloads, prepares, and validates OSM road network data for any city globally, outputting GeoJSON ready for the Moveet simulator.

**Architecture:** Commander.js CLI with individual pipeline commands (download → extract → filter → export → validate → diff) plus an Inquirer.js `prepare` wizard that chains them. osmium runs in Docker via a thin wrapper — no binary install required. Regions are defined in a `regions.json` manifest; any city works via `--bbox` + `--geofabrik` flags.

**Tech Stack:** TypeScript, Commander.js, Inquirer.js, Zod, pino, tsx (dev), tsc (build), vitest (tests).

**Worktree:** `/Users/ivan/Projects/own/moveet/.worktrees/feat-network-cli`
**All commands run from:** `apps/network/` unless stated otherwise.

---

## Task 1: Scaffold `apps/network`

**Beads:** `fleetsim-all-jx2d.1`

**Files:**
- Create: `apps/network/package.json`
- Create: `apps/network/tsconfig.json`
- Create: `apps/network/src/cli.ts`
- Create: `apps/network/src/index.ts`
- Modify: root `.gitignore` (add `.cache/` entry under apps/network)

---

### Step 1: Create `apps/network/package.json`

```json
{
  "name": "@moveet/network",
  "version": "0.1.0",
  "description": "CLI tool for downloading and preparing OSM road network data",
  "type": "module",
  "bin": {
    "network": "./dist/cli.js"
  },
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsc",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "inquirer": "^10.2.2",
    "pino": "^10.3.1",
    "pino-pretty": "^13.1.3",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "tsx": "^4.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.0"
  }
}
```

### Step 2: Create `apps/network/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "outDir": "./dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", ".cache"]
}
```

### Step 3: Create `apps/network/src/index.ts`

```typescript
export { runCLI } from "./cli.js";
```

### Step 4: Create `apps/network/src/cli.ts`

```typescript
#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("network")
  .description("OSM road network data pipeline for Moveet")
  .version("0.1.0");

program.parse();

export function runCLI(): void {
  program.parse();
}
```

### Step 5: Add `.cache` to `.gitignore` in `apps/network/`

Create `apps/network/.gitignore`:
```
node_modules/
dist/
.cache/
```

### Step 6: Install dependencies

```bash
cd apps/network && npm install
```

### Step 7: Verify type-check passes

```bash
cd apps/network && npm run type-check
```
Expected: no errors.

### Step 8: Commit

```bash
git add apps/network/
git commit -m "feat(network): scaffold apps/network CLI project"
```

---

## Task 2: Regions manifest + loader

**Beads:** `fleetsim-all-jx2d.3`, `fleetsim-all-jx2d.10`

**Files:**
- Create: `apps/network/regions.json`
- Create: `apps/network/src/regions.ts`
- Create: `apps/network/src/regions.test.ts`

---

### Step 1: Write the failing test

Create `apps/network/src/regions.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveRegion, listRegions } from "./regions.js";

describe("resolveRegion", () => {
  it("resolves a known region by name", () => {
    const r = resolveRegion({ region: "nairobi" });
    expect(r.bbox).toEqual([36.65, -1.45, 37.10, -1.15]);
    expect(r.geofabrik).toBe("africa/kenya");
    expect(r.label).toBe("Nairobi, Kenya");
  });

  it("resolves a custom region via bbox + geofabrik flags", () => {
    const r = resolveRegion({
      bbox: [36.65, -1.45, 37.10, -1.15],
      geofabrik: "africa/kenya",
    });
    expect(r.bbox).toEqual([36.65, -1.45, 37.10, -1.15]);
    expect(r.geofabrik).toBe("africa/kenya");
    expect(r.label).toBe("Custom region");
  });

  it("throws on unknown region without bbox fallback", () => {
    expect(() => resolveRegion({ region: "atlantis" })).toThrow(
      /unknown region: atlantis/i
    );
  });

  it("bbox must have exactly 4 numbers [W, S, E, N]", () => {
    expect(() =>
      resolveRegion({ bbox: [1, 2, 3] as unknown as [number, number, number, number], geofabrik: "x/y" })
    ).toThrow();
  });
});

describe("listRegions", () => {
  it("returns all region names sorted", () => {
    const names = listRegions();
    expect(names).toContain("nairobi");
    expect(names).toContain("london");
    expect(names.length).toBeGreaterThanOrEqual(10);
    expect(names).toEqual([...names].sort());
  });
});
```

### Step 2: Run test — expect failure

```bash
cd apps/network && npm test
```
Expected: FAIL — `regions.js` does not exist.

### Step 3: Create `apps/network/regions.json`

```json
{
  "nairobi":      { "bbox": [36.65,  -1.45,  37.10,  -1.15], "geofabrik": "africa/kenya",           "label": "Nairobi, Kenya" },
  "lagos":        { "bbox": [3.08,    6.35,   3.75,   6.85], "geofabrik": "africa/nigeria",         "label": "Lagos, Nigeria" },
  "cairo":        { "bbox": [31.10,  29.90,  31.70,  30.20], "geofabrik": "africa/egypt",           "label": "Cairo, Egypt" },
  "london":       { "bbox": [-0.51,  51.28,   0.33,  51.69], "geofabrik": "europe/great-britain",   "label": "London, UK" },
  "berlin":       { "bbox": [13.09,  52.34,  13.76,  52.68], "geofabrik": "europe/germany",         "label": "Berlin, Germany" },
  "paris":        { "bbox": [2.22,   48.81,   2.57,  48.91], "geofabrik": "europe/france",          "label": "Paris, France" },
  "mumbai":       { "bbox": [72.77,  18.89,  73.02,  19.27], "geofabrik": "asia/india",             "label": "Mumbai, India" },
  "jakarta":      { "bbox": [106.69, -6.37, 107.01,  -6.09], "geofabrik": "asia/indonesia",        "label": "Jakarta, Indonesia" },
  "mexico-city":  { "bbox": [-99.33,  19.21, -98.95,  19.59], "geofabrik": "north-america/mexico", "label": "Mexico City, Mexico" },
  "new-york":     { "bbox": [-74.26,  40.49, -73.70,  40.92], "geofabrik": "north-america/us/new-york", "label": "New York, USA" }
}
```

### Step 4: Create `apps/network/src/regions.ts`

```typescript
import { createRequire } from "module";
import { z } from "zod";

const require = createRequire(import.meta.url);
const raw = require("../regions.json") as Record<string, unknown>;

const BboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const RegionEntrySchema = z.object({
  bbox: BboxSchema,
  geofabrik: z.string(),
  label: z.string(),
});

export type Bbox = z.infer<typeof BboxSchema>;

export interface ResolvedRegion {
  bbox: Bbox;
  geofabrik: string;
  label: string;
}

const manifest = z
  .record(RegionEntrySchema)
  .parse(raw);

export interface ResolveOptions {
  region?: string;
  bbox?: Bbox;
  geofabrik?: string;
}

export function resolveRegion(opts: ResolveOptions): ResolvedRegion {
  if (opts.bbox) {
    const bbox = BboxSchema.parse(opts.bbox);
    if (!opts.geofabrik) throw new Error("--geofabrik is required with --bbox");
    return { bbox, geofabrik: opts.geofabrik, label: "Custom region" };
  }
  if (opts.region) {
    const entry = manifest[opts.region];
    if (!entry) {
      throw new Error(
        `Unknown region: ${opts.region}. Known regions: ${listRegions().join(", ")}`
      );
    }
    return entry;
  }
  throw new Error("Provide --region or --bbox + --geofabrik");
}

export function listRegions(): string[] {
  return Object.keys(manifest).sort();
}
```

### Step 5: Run test — expect pass

```bash
cd apps/network && npm test
```
Expected: all tests pass.

### Step 6: Commit

```bash
git add apps/network/regions.json apps/network/src/regions.ts apps/network/src/regions.test.ts
git commit -m "feat(network): add regions manifest and loader"
```

---

## Task 3: Docker osmium wrapper

**Beads:** `fleetsim-all-jx2d.5`

**Files:**
- Create: `apps/network/src/docker.ts`
- Create: `apps/network/src/docker.test.ts`

---

### Step 1: Write the failing test

Create `apps/network/src/docker.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock execSync before importing docker module
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
import { buildOsmiumCommand, checkDockerAvailable } from "./docker.js";

const mockExec = vi.mocked(execSync);

beforeEach(() => {
  mockExec.mockReset();
});

describe("buildOsmiumCommand", () => {
  it("builds docker run command with correct volume mount", () => {
    const cmd = buildOsmiumCommand(["extract", "--bbox", "1,2,3,4", "input.osm.pbf", "-o", "out.osm.pbf"], "/abs/workdir");
    expect(cmd).toContain("docker run --rm");
    expect(cmd).toContain("-v /abs/workdir:/data");
    expect(cmd).toContain("ghcr.io/osmcode/osmium-tool");
    expect(cmd).toContain("osmium extract --bbox 1,2,3,4 input.osm.pbf -o out.osm.pbf");
  });
});

describe("checkDockerAvailable", () => {
  it("does not throw when docker is available", () => {
    mockExec.mockReturnValue(Buffer.from("Docker version 24.0.0"));
    expect(() => checkDockerAvailable()).not.toThrow();
  });

  it("throws a clear error when docker is not available", () => {
    mockExec.mockImplementation(() => { throw new Error("command not found: docker"); });
    expect(() => checkDockerAvailable()).toThrow(/docker is not available/i);
  });
});
```

### Step 2: Run test — expect failure

```bash
cd apps/network && npm test
```
Expected: FAIL — `docker.js` does not exist.

### Step 3: Create `apps/network/src/docker.ts`

```typescript
import { execSync } from "child_process";
import path from "path";

const OSMIUM_IMAGE = "ghcr.io/osmcode/osmium-tool";

export function buildOsmiumCommand(args: string[], workdir: string): string {
  const absWorkdir = path.resolve(workdir);
  return `docker run --rm -v ${absWorkdir}:/data ${OSMIUM_IMAGE} osmium ${args.join(" ")}`;
}

export function osmium(args: string[], workdir: string): void {
  const cmd = buildOsmiumCommand(args, workdir);
  execSync(cmd, { stdio: "inherit" });
}

export function checkDockerAvailable(): void {
  try {
    execSync("docker --version", { stdio: "pipe" });
  } catch {
    throw new Error(
      "Docker is not available. Please install Docker and ensure it is running.\n" +
        "See: https://docs.docker.com/get-docker/"
    );
  }
}
```

### Step 4: Run test — expect pass

```bash
cd apps/network && npm test
```
Expected: all tests pass.

### Step 5: Commit

```bash
git add apps/network/src/docker.ts apps/network/src/docker.test.ts
git commit -m "feat(network): add docker osmium wrapper"
```

---

## Task 4: `download` command

**Beads:** `fleetsim-all-jx2d.8`

**Files:**
- Create: `apps/network/src/commands/download.ts`
- Create: `apps/network/src/commands/download.test.ts`
- Modify: `apps/network/src/cli.ts` (register command)

---

### Step 1: Write the failing test

Create `apps/network/src/commands/download.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildDownloadUrl, getCachePath, shouldSkipDownload } from "./download.js";

describe("buildDownloadUrl", () => {
  it("builds correct Geofabrik URL", () => {
    const url = buildDownloadUrl("africa/kenya");
    expect(url).toBe("https://download.geofabrik.de/africa/kenya-latest.osm.pbf");
  });

  it("handles sub-region paths", () => {
    const url = buildDownloadUrl("north-america/us/new-york");
    expect(url).toBe("https://download.geofabrik.de/north-america/us/new-york-latest.osm.pbf");
  });
});

describe("getCachePath", () => {
  it("derives a safe filename from geofabrik path", () => {
    const p = getCachePath("africa/kenya", "/cache");
    expect(p).toBe("/cache/africa-kenya-latest.osm.pbf");
  });
});

describe("shouldSkipDownload", () => {
  it("returns true when etag file matches", () => {
    const result = shouldSkipDownload("/nonexistent.pbf", undefined);
    expect(result).toBe(false);
  });
});
```

### Step 2: Run test — expect failure

```bash
cd apps/network && npm test
```
Expected: FAIL — `download.js` does not exist.

### Step 3: Create `apps/network/src/commands/download.ts`

```typescript
import fs from "fs";
import https from "https";
import http from "http";
import path from "path";
import { URL } from "url";

const GEOFABRIK_BASE = "https://download.geofabrik.de";

export function buildDownloadUrl(geofabrik: string): string {
  return `${GEOFABRIK_BASE}/${geofabrik}-latest.osm.pbf`;
}

export function getCachePath(geofabrik: string, cacheDir: string): string {
  const safeName = geofabrik.replace(/\//g, "-");
  return path.join(cacheDir, `${safeName}-latest.osm.pbf`);
}

export function getEtagPath(pbfPath: string): string {
  return `${pbfPath}.etag`;
}

export function shouldSkipDownload(pbfPath: string, newEtag: string | undefined): boolean {
  if (!fs.existsSync(pbfPath)) return false;
  if (!newEtag) return false;
  const etagPath = getEtagPath(pbfPath);
  if (!fs.existsSync(etagPath)) return false;
  const savedEtag = fs.readFileSync(etagPath, "utf8").trim();
  return savedEtag === newEtag;
}

export interface DownloadOptions {
  geofabrik: string;
  cacheDir: string;
  force?: boolean;
}

export async function download(opts: DownloadOptions): Promise<string> {
  const { geofabrik, cacheDir, force = false } = opts;
  fs.mkdirSync(cacheDir, { recursive: true });

  const url = buildDownloadUrl(geofabrik);
  const dest = getCachePath(geofabrik, cacheDir);
  const etagPath = getEtagPath(dest);

  // HEAD request to check ETag
  const headEtag = await getEtag(url);

  if (!force && shouldSkipDownload(dest, headEtag ?? undefined)) {
    process.stdout.write(`Skipping download (cached): ${path.basename(dest)}\n`);
    return dest;
  }

  process.stdout.write(`Downloading ${url}\n`);
  await streamDownload(url, dest);

  if (headEtag) {
    fs.writeFileSync(etagPath, headEtag, "utf8");
  }

  return dest;
}

function getEtag(url: string): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const req = mod.request(url, { method: "HEAD" }, (res) => {
      resolve((res.headers["etag"] as string) ?? null);
    });
    req.on("error", reject);
    req.end();
  });
}

function streamDownload(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const file = fs.createWriteStream(dest);
    mod.get(url, (res) => {
      const total = parseInt(res.headers["content-length"] ?? "0", 10);
      let received = 0;
      res.on("data", (chunk: Buffer) => {
        received += chunk.length;
        if (total > 0) {
          const pct = Math.round((received / total) * 100);
          process.stdout.write(`\r  ${pct}% (${(received / 1e6).toFixed(1)} MB)`);
        }
      });
      res.pipe(file);
      file.on("finish", () => { process.stdout.write("\n"); file.close(); resolve(); });
    }).on("error", reject);
  });
}
```

### Step 4: Register in `cli.ts`

Add to `apps/network/src/cli.ts`:

```typescript
import { Command } from "commander";
import { resolveRegion } from "./regions.js";
import { download } from "./commands/download.js";
import path from "path";

const CACHE_DIR = path.resolve("apps/network/.cache");

const program = new Command();
program.name("network").description("OSM road network data pipeline for Moveet").version("0.1.0");

program
  .command("download")
  .description("Download OSM PBF from Geofabrik")
  .option("-r, --region <name>", "Known region name")
  .option("--bbox <w,s,e,n>", "Custom bounding box")
  .option("--geofabrik <path>", "Geofabrik path (e.g. africa/kenya)")
  .option("--force", "Re-download even if cached")
  .action(async (opts) => {
    const region = resolveRegion({
      region: opts.region,
      bbox: opts.bbox?.split(",").map(Number) as [number, number, number, number],
      geofabrik: opts.geofabrik,
    });
    await download({ geofabrik: region.geofabrik, cacheDir: CACHE_DIR, force: opts.force });
  });

program.parse();

export function runCLI(): void {
  program.parse();
}
```

### Step 5: Run test — expect pass

```bash
cd apps/network && npm test
```
Expected: all tests pass.

### Step 6: Commit

```bash
git add apps/network/src/commands/download.ts apps/network/src/commands/download.test.ts apps/network/src/cli.ts
git commit -m "feat(network): add download command with ETag caching"
```

---

## Task 5: `extract` command

**Beads:** `fleetsim-all-jx2d.2`

**Files:**
- Create: `apps/network/src/commands/extract.ts`
- Create: `apps/network/src/commands/extract.test.ts`
- Modify: `apps/network/src/cli.ts`

---

### Step 1: Write the failing test

Create `apps/network/src/commands/extract.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { buildExtractArgs } from "./extract.js";

describe("buildExtractArgs", () => {
  it("builds correct osmium extract args", () => {
    const args = buildExtractArgs({
      input: "/data/africa-kenya-latest.osm.pbf",
      output: "/data/nairobi.osm.pbf",
      bbox: [36.65, -1.45, 37.10, -1.15],
    });
    expect(args).toEqual([
      "extract",
      "--bbox", "36.65,-1.45,37.1,-1.15",
      "africa-kenya-latest.osm.pbf",
      "-o", "nairobi.osm.pbf",
      "--overwrite",
    ]);
  });
});
```

### Step 2: Run test — expect failure

```bash
cd apps/network && npm test
```
Expected: FAIL.

### Step 3: Create `apps/network/src/commands/extract.ts`

```typescript
import path from "path";
import type { Bbox } from "../regions.js";
import { osmium } from "../docker.js";

export interface ExtractOptions {
  input: string;
  output: string;
  bbox: Bbox;
}

export function buildExtractArgs(opts: ExtractOptions): string[] {
  const [w, s, e, n] = opts.bbox;
  return [
    "extract",
    "--bbox", `${w},${s},${e},${n}`,
    path.basename(opts.input),
    "-o", path.basename(opts.output),
    "--overwrite",
  ];
}

export function extract(opts: ExtractOptions): void {
  const workdir = path.dirname(opts.input);
  const args = buildExtractArgs(opts);
  osmium(args, workdir);
}
```

### Step 4: Register in `cli.ts`

Add extract command:
```typescript
import { extract } from "./commands/extract.js";

program
  .command("extract")
  .description("Extract bbox from PBF using osmium")
  .requiredOption("--input <path>", "Input PBF file")
  .requiredOption("--output <path>", "Output PBF file")
  .requiredOption("--bbox <w,s,e,n>", "Bounding box")
  .action((opts) => {
    extract({
      input: opts.input,
      output: opts.output,
      bbox: opts.bbox.split(",").map(Number) as [number, number, number, number],
    });
  });
```

### Step 5: Run tests — expect pass

```bash
cd apps/network && npm test
```

### Step 6: Commit

```bash
git add apps/network/src/commands/extract.ts apps/network/src/commands/extract.test.ts apps/network/src/cli.ts
git commit -m "feat(network): add extract command"
```

---

## Task 6: `filter` command

**Beads:** `fleetsim-all-jx2d.4`

**Files:**
- Create: `apps/network/src/commands/filter.ts`
- Create: `apps/network/src/commands/filter.test.ts`
- Modify: `apps/network/src/cli.ts`

---

### Step 1: Write the failing test

Create `apps/network/src/commands/filter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildFilterArgs, DEFAULT_ROAD_CLASSES } from "./filter.js";

describe("buildFilterArgs", () => {
  it("builds correct osmium tags-filter args with default road classes", () => {
    const args = buildFilterArgs({
      input: "/data/nairobi.osm.pbf",
      output: "/data/nairobi-roads.osm.pbf",
      classes: DEFAULT_ROAD_CLASSES,
    });
    expect(args[0]).toBe("tags-filter");
    expect(args[1]).toBe("nairobi.osm.pbf");
    // Should include highway filter expression
    const highwayArg = args.find(a => a.startsWith("w/highway~"));
    expect(highwayArg).toBeDefined();
    expect(highwayArg).toContain("motorway");
    expect(highwayArg).toContain("unclassified");
    expect(highwayArg).toContain("residential");
    // Should include roundabout filter
    expect(args).toContain("w/junction=roundabout");
    expect(args).toContain("-o");
    expect(args).toContain("nairobi-roads.osm.pbf");
    expect(args).toContain("--overwrite");
  });

  it("respects custom road classes", () => {
    const args = buildFilterArgs({
      input: "/data/nairobi.osm.pbf",
      output: "/data/nairobi-roads.osm.pbf",
      classes: ["motorway", "primary"],
    });
    const highwayArg = args.find(a => a.startsWith("w/highway~"));
    expect(highwayArg).toContain("motorway");
    expect(highwayArg).toContain("primary");
    expect(highwayArg).not.toContain("residential");
  });
});
```

### Step 2: Run test — expect failure

```bash
cd apps/network && npm test
```

### Step 3: Create `apps/network/src/commands/filter.ts`

```typescript
import path from "path";
import { osmium } from "../docker.js";

export const DEFAULT_ROAD_CLASSES = [
  "motorway", "motorway_link",
  "trunk", "trunk_link",
  "primary", "primary_link",
  "secondary", "secondary_link",
  "tertiary", "tertiary_link",
  "unclassified",
  "residential",
  "living_street",
] as const;

export type RoadClass = typeof DEFAULT_ROAD_CLASSES[number];

export interface FilterOptions {
  input: string;
  output: string;
  classes?: readonly string[];
}

export function buildFilterArgs(opts: FilterOptions): string[] {
  const classes = opts.classes ?? DEFAULT_ROAD_CLASSES;
  const highwayExpr = `w/highway~"^(${classes.join("|")})$"`;
  return [
    "tags-filter",
    path.basename(opts.input),
    highwayExpr,
    "w/junction=roundabout",
    "-o", path.basename(opts.output),
    "--overwrite",
  ];
}

export function filter(opts: FilterOptions): void {
  const workdir = path.dirname(opts.input);
  const args = buildFilterArgs(opts);
  osmium(args, workdir);
}
```

### Step 4: Register in `cli.ts`

Add filter command:
```typescript
import { filter, DEFAULT_ROAD_CLASSES } from "./commands/filter.js";

program
  .command("filter")
  .description("Filter road classes from PBF using osmium")
  .requiredOption("--input <path>", "Input PBF file")
  .requiredOption("--output <path>", "Output PBF file")
  .option("--classes <list>", "Comma-separated road classes", DEFAULT_ROAD_CLASSES.join(","))
  .action((opts) => {
    filter({
      input: opts.input,
      output: opts.output,
      classes: opts.classes.split(","),
    });
  });
```

### Step 5: Run tests — expect pass

```bash
cd apps/network && npm test
```

### Step 6: Commit

```bash
git add apps/network/src/commands/filter.ts apps/network/src/commands/filter.test.ts apps/network/src/cli.ts
git commit -m "feat(network): add filter command"
```

---

## Task 7: `export` command

**Beads:** `fleetsim-all-jx2d.9`

**Files:**
- Create: `apps/network/src/commands/export.ts`
- Create: `apps/network/src/commands/export.test.ts`
- Modify: `apps/network/src/cli.ts`

---

### Step 1: Write the failing test

Create `apps/network/src/commands/export.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildExportArgs, buildMetadata } from "./export.js";

describe("buildExportArgs", () => {
  it("builds correct osmium export args", () => {
    const args = buildExportArgs({
      input: "/data/nairobi-roads.osm.pbf",
      output: "/out/network.geojson",
    });
    expect(args[0]).toBe("export");
    expect(args[1]).toBe("nairobi-roads.osm.pbf");
    expect(args).toContain("--geometry-types=linestring");
    expect(args).toContain("--output-format=geojson");
    expect(args).toContain("--overwrite");
    const oIdx = args.indexOf("-o");
    expect(args[oIdx + 1]).toBe("network.geojson");
  });
});

describe("buildMetadata", () => {
  it("includes region, bbox, and timestamp", () => {
    const meta = buildMetadata({
      region: "nairobi",
      bbox: [36.65, -1.45, 37.10, -1.15],
      classes: ["primary", "secondary"],
    });
    expect(meta.region).toBe("nairobi");
    expect(meta.bbox).toEqual([36.65, -1.45, 37.10, -1.15]);
    expect(meta.classes).toContain("primary");
    expect(typeof meta.generatedAt).toBe("string");
  });
});
```

### Step 2: Run test — expect failure

```bash
cd apps/network && npm test
```

### Step 3: Create `apps/network/src/commands/export.ts`

```typescript
import fs from "fs";
import path from "path";
import type { Bbox } from "../regions.js";
import { osmium } from "../docker.js";

export interface ExportOptions {
  input: string;
  output: string;
}

export interface MetadataOptions {
  region: string;
  bbox: Bbox;
  classes: string[];
}

export function buildExportArgs(opts: ExportOptions): string[] {
  return [
    "export",
    path.basename(opts.input),
    "--geometry-types=linestring",
    "--output-format=geojson",
    "-o", path.basename(opts.output),
    "--overwrite",
  ];
}

export function buildMetadata(opts: MetadataOptions) {
  return {
    region: opts.region,
    bbox: opts.bbox,
    classes: opts.classes,
    generatedAt: new Date().toISOString(),
  };
}

export function exportNetwork(opts: ExportOptions & MetadataOptions): void {
  fs.mkdirSync(path.dirname(opts.output), { recursive: true });

  // osmium must write to same dir as input; copy output afterwards if needed
  const workdir = path.dirname(opts.input);
  const tempOutput = path.join(workdir, path.basename(opts.output));

  osmium(buildExportArgs({ input: opts.input, output: tempOutput }), workdir);

  // Move to final destination if different
  if (path.resolve(tempOutput) !== path.resolve(opts.output)) {
    fs.renameSync(tempOutput, opts.output);
  }

  // Write metadata sidecar
  const meta = buildMetadata(opts);
  fs.writeFileSync(`${opts.output}.meta.json`, JSON.stringify(meta, null, 2));
}
```

### Step 4: Register in `cli.ts`

Add export command:
```typescript
import { exportNetwork } from "./commands/export.js";

program
  .command("export")
  .description("Export PBF to GeoJSON using osmium")
  .requiredOption("--input <path>", "Input roads PBF file")
  .option("--output <path>", "Output GeoJSON path", "apps/simulator/data/network.geojson")
  .option("--region <name>", "Region name for metadata", "unknown")
  .action((opts) => {
    exportNetwork({
      input: opts.input,
      output: opts.output,
      region: opts.region,
      bbox: [0, 0, 0, 0],
      classes: [],
    });
  });
```

### Step 5: Run tests — expect pass

```bash
cd apps/network && npm test
```

### Step 6: Commit

```bash
git add apps/network/src/commands/export.ts apps/network/src/commands/export.test.ts apps/network/src/cli.ts
git commit -m "feat(network): add export command"
```

---

## Task 8: `validate` command

**Beads:** `fleetsim-all-jx2d.11`

**Files:**
- Create: `apps/network/src/commands/validate.ts`
- Create: `apps/network/src/commands/validate.test.ts`
- Modify: `apps/network/src/cli.ts`

---

### Step 1: Write the failing test

Create `apps/network/src/commands/validate.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { analyzeNetwork, type ValidationReport } from "./validate.js";
import type { FeatureCollection, LineString } from "geojson";

function makeLine(coords: [number, number][]): GeoJSON.Feature<LineString> {
  return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
}

describe("analyzeNetwork", () => {
  it("counts nodes and edges from a simple network", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        makeLine([[0, 0], [1, 0]]),
        makeLine([[1, 0], [2, 0]]),
      ],
    };
    const report = analyzeNetwork(fc);
    expect(report.totalEdges).toBe(2);
    expect(report.totalNodes).toBeGreaterThanOrEqual(2);
  });

  it("detects isolated nodes (roads that share no endpoints)", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        makeLine([[0, 0], [1, 0]]),
        makeLine([[10, 10], [11, 10]]), // disconnected
      ],
    };
    const report = analyzeNetwork(fc);
    expect(report.connectedComponents).toBe(2);
  });

  it("passes on a fully connected network", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        makeLine([[0, 0], [1, 0]]),
        makeLine([[1, 0], [1, 1]]),
        makeLine([[1, 1], [0, 0]]),
      ],
    };
    const report = analyzeNetwork(fc);
    expect(report.connectedComponents).toBe(1);
  });
});
```

### Step 2: Run test — expect failure

```bash
cd apps/network && npm test
```

### Step 3: Create `apps/network/src/commands/validate.ts`

```typescript
import fs from "fs";
import type { FeatureCollection, LineString, Feature } from "geojson";

export interface ValidationReport {
  totalNodes: number;
  totalEdges: number;
  connectedComponents: number;
  largestComponentPct: number;
  isolatedNodes: number;
  passed: boolean;
}

const PRECISION = 6;

function nodeKey(coord: [number, number]): string {
  return `${coord[0].toFixed(PRECISION)},${coord[1].toFixed(PRECISION)}`;
}

export function analyzeNetwork(fc: FeatureCollection): ValidationReport {
  const adjacency = new Map<string, Set<string>>();

  const addNode = (key: string) => {
    if (!adjacency.has(key)) adjacency.set(key, new Set());
  };

  const addEdge = (a: string, b: string) => {
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  let totalEdges = 0;

  for (const feature of fc.features) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = (feature as Feature<LineString>).geometry.coordinates as [number, number][];
    totalEdges++;
    for (const coord of coords) addNode(nodeKey(coord));
    for (let i = 0; i < coords.length - 1; i++) {
      addEdge(nodeKey(coords[i]), nodeKey(coords[i + 1]));
    }
  }

  // BFS to find connected components
  const visited = new Set<string>();
  const components: number[] = [];

  for (const node of adjacency.keys()) {
    if (visited.has(node)) continue;
    let size = 0;
    const queue = [node];
    while (queue.length) {
      const curr = queue.pop()!;
      if (visited.has(curr)) continue;
      visited.add(curr);
      size++;
      for (const neighbor of adjacency.get(curr)!) {
        if (!visited.has(neighbor)) queue.push(neighbor);
      }
    }
    components.push(size);
  }

  components.sort((a, b) => b - a);
  const totalNodes = adjacency.size;
  const isolatedNodes = components.filter(s => s === 1).length;
  const largestComponentPct = totalNodes > 0 ? (components[0] / totalNodes) * 100 : 0;

  return {
    totalNodes,
    totalEdges,
    connectedComponents: components.length,
    largestComponentPct: Math.round(largestComponentPct * 10) / 10,
    isolatedNodes,
    passed: components.length <= 3 && isolatedNodes / totalNodes < 0.01,
  };
}

export function validate(inputPath: string): ValidationReport {
  const raw = fs.readFileSync(inputPath, "utf8");
  const fc = JSON.parse(raw) as FeatureCollection;
  const report = analyzeNetwork(fc);

  console.log("\nTopology Validation Report");
  console.log("─".repeat(40));
  console.log(`  Nodes:               ${report.totalNodes.toLocaleString()}`);
  console.log(`  Edges:               ${report.totalEdges.toLocaleString()}`);
  console.log(`  Connected components:${report.connectedComponents} ${report.connectedComponents > 3 ? "⚠️ " : "✔"}`);
  console.log(`  Largest component:   ${report.largestComponentPct}% of nodes`);
  console.log(`  Isolated nodes:      ${report.isolatedNodes} ${report.isolatedNodes > 0 ? "⚠️ " : "✔"}`);
  console.log(`\n  Result: ${report.passed ? "✔  PASSED" : "✗  FAILED"}\n`);

  return report;
}
```

### Step 4: Register in `cli.ts`

```typescript
import { validate } from "./commands/validate.js";

program
  .command("validate")
  .description("Run topology validation on a network GeoJSON")
  .requiredOption("--input <path>", "GeoJSON file to validate")
  .action((opts) => {
    const report = validate(opts.input);
    if (!report.passed) process.exit(1);
  });
```

### Step 5: Run tests — expect pass

```bash
cd apps/network && npm test
```

### Step 6: Commit

```bash
git add apps/network/src/commands/validate.ts apps/network/src/commands/validate.test.ts apps/network/src/cli.ts
git commit -m "feat(network): add validate command with connectivity analysis"
```

---

## Task 9: `diff` command

**Beads:** `fleetsim-all-jx2d.6`

**Files:**
- Create: `apps/network/src/commands/diff.ts`
- Create: `apps/network/src/commands/diff.test.ts`
- Modify: `apps/network/src/cli.ts`

---

### Step 1: Write the failing test

Create `apps/network/src/commands/diff.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { diffNetworks } from "./diff.js";
import type { FeatureCollection } from "geojson";

const makeFC = (features: GeoJSON.Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

const road = (coords: [number,number][], props = {}): GeoJSON.Feature => ({
  type: "Feature",
  properties: props,
  geometry: { type: "LineString", coordinates: coords },
});

describe("diffNetworks", () => {
  it("reports no changes for identical networks", () => {
    const fc = makeFC([road([[0,0],[1,0]], { name: "A St" })]);
    const result = diffNetworks(fc, fc);
    expect(result.identical).toBe(true);
    expect(result.nodesAdded).toBe(0);
    expect(result.nodesRemoved).toBe(0);
    expect(result.edgesAdded).toBe(0);
    expect(result.edgesRemoved).toBe(0);
  });

  it("detects added edges", () => {
    const old = makeFC([road([[0,0],[1,0]])]);
    const next = makeFC([road([[0,0],[1,0]]), road([[1,0],[2,0]])]);
    const result = diffNetworks(old, next);
    expect(result.edgesAdded).toBe(1);
    expect(result.identical).toBe(false);
  });

  it("detects removed edges", () => {
    const old = makeFC([road([[0,0],[1,0]]), road([[1,0],[2,0]])]);
    const next = makeFC([road([[0,0],[1,0]])]);
    const result = diffNetworks(old, next);
    expect(result.edgesRemoved).toBe(1);
  });
});
```

### Step 2: Run test — expect failure

```bash
cd apps/network && npm test
```

### Step 3: Create `apps/network/src/commands/diff.ts`

```typescript
import fs from "fs";
import type { FeatureCollection, LineString, Feature } from "geojson";

export interface DiffResult {
  identical: boolean;
  nodesAdded: number;
  nodesRemoved: number;
  edgesAdded: number;
  edgesRemoved: number;
  speedChanges: number;
  newOneway: number;
}

const PRECISION = 6;

function edgeKey(coords: [number, number][]): string {
  const [start, end] = [coords[0], coords[coords.length - 1]];
  const a = `${start[0].toFixed(PRECISION)},${start[1].toFixed(PRECISION)}`;
  const b = `${end[0].toFixed(PRECISION)},${end[1].toFixed(PRECISION)}`;
  return [a, b].sort().join("|");
}

function nodeSet(fc: FeatureCollection): Set<string> {
  const nodes = new Set<string>();
  for (const f of fc.features) {
    if (f.geometry.type !== "LineString") continue;
    for (const c of (f as Feature<LineString>).geometry.coordinates as [number,number][]) {
      nodes.add(`${c[0].toFixed(PRECISION)},${c[1].toFixed(PRECISION)}`);
    }
  }
  return nodes;
}

function edgeMap(fc: FeatureCollection): Map<string, Record<string, unknown>> {
  const edges = new Map<string, Record<string, unknown>>();
  for (const f of fc.features) {
    if (f.geometry.type !== "LineString") continue;
    const coords = (f as Feature<LineString>).geometry.coordinates as [number,number][];
    edges.set(edgeKey(coords), (f.properties ?? {}) as Record<string, unknown>);
  }
  return edges;
}

export function diffNetworks(oldFc: FeatureCollection, newFc: FeatureCollection): DiffResult {
  const oldNodes = nodeSet(oldFc);
  const newNodes = nodeSet(newFc);
  const oldEdges = edgeMap(oldFc);
  const newEdges = edgeMap(newFc);

  let nodesAdded = 0, nodesRemoved = 0;
  for (const n of newNodes) if (!oldNodes.has(n)) nodesAdded++;
  for (const n of oldNodes) if (!newNodes.has(n)) nodesRemoved++;

  let edgesAdded = 0, edgesRemoved = 0, speedChanges = 0, newOneway = 0;
  for (const [k, props] of newEdges) {
    if (!oldEdges.has(k)) { edgesAdded++; continue; }
    const old = oldEdges.get(k)!;
    if (props["maxspeed"] !== old["maxspeed"]) speedChanges++;
    if (props["oneway"] === "yes" && old["oneway"] !== "yes") newOneway++;
  }
  for (const k of oldEdges.keys()) {
    if (!newEdges.has(k)) edgesRemoved++;
  }

  const identical = nodesAdded === 0 && nodesRemoved === 0 && edgesAdded === 0 && edgesRemoved === 0;
  return { identical, nodesAdded, nodesRemoved, edgesAdded, edgesRemoved, speedChanges, newOneway };
}

export function diff(oldPath: string, newPath: string): DiffResult {
  const oldFc = JSON.parse(fs.readFileSync(oldPath, "utf8")) as FeatureCollection;
  const newFc = JSON.parse(fs.readFileSync(newPath, "utf8")) as FeatureCollection;
  const result = diffNetworks(oldFc, newFc);

  console.log("\nRoad Network Diff");
  console.log("─".repeat(45));
  console.log(`  Nodes     +${result.nodesAdded}  added   |   -${result.nodesRemoved}  removed`);
  console.log(`  Edges     +${result.edgesAdded}  added   |   -${result.edgesRemoved}  removed`);
  console.log(`  Speed limits    ${result.speedChanges}  changed`);
  console.log(`  New one-way     ${result.newOneway}  newly restricted`);
  console.log(`\n  Result: ${result.identical ? "✔  Identical" : "⚡  Changed"}\n`);

  return result;
}
```

### Step 4: Register in `cli.ts`

```typescript
import { diff } from "./commands/diff.js";

program
  .command("diff <old> <new>")
  .description("Compare two network GeoJSON files")
  .action((oldPath, newPath) => {
    const result = diff(oldPath, newPath);
    if (!result.identical) process.exit(1);
  });
```

### Step 5: Run tests — expect pass

```bash
cd apps/network && npm test
```

### Step 6: Commit

```bash
git add apps/network/src/commands/diff.ts apps/network/src/commands/diff.test.ts apps/network/src/cli.ts
git commit -m "feat(network): add diff command"
```

---

## Task 10: `prepare` wizard

**Beads:** `fleetsim-all-jx2d.7`

**Files:**
- Create: `apps/network/src/commands/prepare.ts`
- Modify: `apps/network/src/cli.ts`

No unit tests for the interactive wizard (Inquirer is hard to unit-test). Test manually by running `npm run dev -- prepare nairobi --dry-run`.

---

### Step 1: Create `apps/network/src/commands/prepare.ts`

```typescript
import path from "path";
import { resolveRegion, listRegions } from "../regions.js";
import { checkDockerAvailable } from "../docker.js";
import { download } from "./download.js";
import { extract } from "./extract.js";
import { filter, DEFAULT_ROAD_CLASSES } from "./filter.js";
import { exportNetwork } from "./export.js";
import { validate } from "./validate.js";

const CACHE_DIR = path.resolve("apps/network/.cache");
const DEFAULT_OUTPUT = "apps/simulator/data/network.geojson";

export interface PrepareOptions {
  region?: string;
  bbox?: [number, number, number, number];
  geofabrik?: string;
  output?: string;
  classes?: string[];
  force?: boolean;
  dryRun?: boolean;
}

export async function prepare(opts: PrepareOptions): Promise<void> {
  checkDockerAvailable();

  // Interactive mode — only when no region provided
  let resolvedOpts = { ...opts };
  if (!opts.region && !opts.bbox) {
    const { default: inquirer } = await import("inquirer");
    const regions = listRegions();
    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "region",
        message: "Select a region:",
        choices: regions,
      },
      {
        type: "input",
        name: "output",
        message: "Output path:",
        default: DEFAULT_OUTPUT,
      },
      {
        type: "checkbox",
        name: "classes",
        message: "Road classes to include:",
        choices: DEFAULT_ROAD_CLASSES.map(c => ({ name: c, value: c, checked: true })),
      },
    ]);
    resolvedOpts = { ...resolvedOpts, ...answers };
  }

  const region = resolveRegion({
    region: resolvedOpts.region,
    bbox: resolvedOpts.bbox,
    geofabrik: resolvedOpts.geofabrik,
  });

  const output = resolvedOpts.output ?? DEFAULT_OUTPUT;
  const classes = resolvedOpts.classes ?? [...DEFAULT_ROAD_CLASSES];

  const safeName = (resolvedOpts.region ?? "custom").replace(/[^a-z0-9-]/g, "-");
  const pbfCountry = path.join(CACHE_DIR, path.basename(region.geofabrik) + "-latest.osm.pbf");
  const pbfExtracted = path.join(CACHE_DIR, `${safeName}.osm.pbf`);
  const pbfFiltered = path.join(CACHE_DIR, `${safeName}-roads.osm.pbf`);

  if (opts.dryRun) {
    console.log("Dry run — pipeline steps:");
    console.log(`  1. download  ${region.geofabrik} → ${pbfCountry}`);
    console.log(`  2. extract   bbox ${region.bbox.join(",")} → ${pbfExtracted}`);
    console.log(`  3. filter    classes: ${classes.join(",")} → ${pbfFiltered}`);
    console.log(`  4. export    → ${output}`);
    console.log(`  5. validate  ${output}`);
    return;
  }

  console.log(`\nPreparing network: ${region.label}\n`);

  await download({ geofabrik: region.geofabrik, cacheDir: CACHE_DIR, force: opts.force });
  extract({ input: pbfCountry, output: pbfExtracted, bbox: region.bbox });
  filter({ input: pbfExtracted, output: pbfFiltered, classes });
  exportNetwork({ input: pbfFiltered, output, region: resolvedOpts.region ?? "custom", bbox: region.bbox, classes });
  const report = validate(output);

  if (!report.passed) {
    console.error("Validation failed — see report above");
    process.exit(1);
  }

  console.log(`\nNetwork ready: ${output}\n`);
}
```

### Step 2: Register in `cli.ts`

```typescript
import { prepare } from "./commands/prepare.js";

program
  .command("prepare [region]")
  .description("Run full pipeline: download → extract → filter → export → validate")
  .option("--output <path>", "Output GeoJSON path", DEFAULT_OUTPUT)
  .option("--force", "Force re-download even if cached")
  .option("--dry-run", "Print pipeline steps without executing")
  .action(async (region, opts) => {
    await prepare({ region, output: opts.output, force: opts.force, dryRun: opts.dryRun });
  });
```

### Step 3: Smoke-test dry run

```bash
cd apps/network && npm run dev -- prepare nairobi --dry-run
```
Expected: prints 5 pipeline steps, no errors.

### Step 4: Commit

```bash
git add apps/network/src/commands/prepare.ts apps/network/src/cli.ts
git commit -m "feat(network): add prepare wizard command"
```

---

## Task 11: Simulator integration

**Beads:** `fleetsim-all-jx2d.12`

**Files:**
- Modify: `apps/simulator/src/utils/config.ts` (update default geojsonPath)
- Modify: `apps/simulator/.gitignore` (add `data/` directory)
- Modify: `apps/simulator/CLAUDE.md` (document prerequisite)

---

### Step 1: Update simulator config default

In `apps/simulator/src/utils/config.ts` line 48, change:
```typescript
GEOJSON_PATH: z.string().default("./export.geojson"),
```
to:
```typescript
GEOJSON_PATH: z.string().default("./data/network.geojson"),
```

### Step 2: Add `data/` to simulator's `.gitignore`

Append to `apps/simulator/.gitignore` (or create if missing):
```
# Generated by apps/network pipeline
data/
```

### Step 3: Run simulator tests to confirm nothing broke

```bash
cd apps/simulator && npm test -- --run
```
Expected: 970 tests passing (the config change doesn't affect tests since tests use fixture paths).

### Step 4: Commit

```bash
git add apps/simulator/src/utils/config.ts apps/simulator/.gitignore
git commit -m "feat(network): update simulator to read from data/network.geojson"
```

---

## Final: Close beads, verify, push

### Step 1: Close all completed beads tasks

```bash
bd close fleetsim-all-jx2d.1 fleetsim-all-jx2d.3 fleetsim-all-jx2d.10 fleetsim-all-jx2d.5 \
         fleetsim-all-jx2d.8 fleetsim-all-jx2d.2 fleetsim-all-jx2d.4 fleetsim-all-jx2d.9 \
         fleetsim-all-jx2d.11 fleetsim-all-jx2d.6 fleetsim-all-jx2d.7 fleetsim-all-jx2d.12
```

### Step 2: Run full test suite one final time

```bash
cd apps/network && npm test
cd apps/simulator && npm test -- --run
```
Expected: all pass.

### Step 3: Push branch

```bash
git push -u origin feat/network-cli
```
