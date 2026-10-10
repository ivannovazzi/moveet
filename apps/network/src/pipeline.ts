import fs from "fs";
import path from "path";
import type { FeatureCollection } from "geojson";
import { checkOsmiumAvailable, osmium } from "./docker.js";
import type { Bbox } from "./regions.js";
import { download, getCachePath } from "./commands/download.js";
import { extract } from "./commands/extract.js";
import { filter, DEFAULT_ROAD_CLASSES } from "./commands/filter.js";
import { exportNetwork } from "./commands/export.js";
import { prune } from "./commands/prune.js";
import { validate, type ValidationReport } from "./commands/validate.js";
import {
  buildBuildingsExportArgs,
  buildBuildingsFilterArgs,
  tileBuildings,
  writeBuildingTiles,
} from "./commands/buildings.js";
import { BuildingTileBuilder } from "./commands/buildingTiles.js";

/**
 * The whole network pipeline as one call, for programs that build maps
 * themselves (the simulator's map build jobs) rather than through the CLI:
 *
 *   download (cached by ETag) -> extract bbox -> filter roads -> export
 *   GeoJSON -> prune -> validate -> optional building tiles
 *
 * Every step is synchronous (osmium runs through execFileSync), so callers that
 * must stay responsive run this in a child process.
 */

export const BUILD_STEPS = [
  "download",
  "extract",
  "filter",
  "export",
  "prune",
  "validate",
  "buildings",
] as const;

export type BuildStep = (typeof BUILD_STEPS)[number];

/** Share of the overall progress each step accounts for (buildings only when requested). */
const STEP_WEIGHTS: Record<BuildStep, number> = {
  download: 0.4,
  extract: 0.15,
  filter: 0.08,
  export: 0.1,
  prune: 0.05,
  validate: 0.04,
  buildings: 0.18,
};

export interface BuildProgress {
  step: BuildStep;
  /** Overall progress, 0..1. */
  progress: number;
  bytesDownloaded?: number;
  totalBytes?: number;
}

export interface BuildMapOptions {
  /** Geofabrik extract path, e.g. `europe/italy/nord-ovest`. */
  geofabrik: string;
  bbox: Bbox;
  /** Where the country `.pbf` is cached between builds. */
  cacheDir: string;
  /** Scratch directory for this build's intermediate extracts; the caller removes it. */
  workDir: string;
  /** Directory receiving `network.geojson` and, optionally, `buildings/`. */
  outDir: string;
  /** Region name stamped into the export metadata and building index. */
  regionName: string;
  /** Also build 3D building tiles (default true). */
  buildings?: boolean;
  classes?: readonly string[];
  onProgress?: (progress: BuildProgress) => void;
}

export interface BuildMapResult {
  /** GeoJSON features in `network.geojson`. */
  featureCount: number;
  /** `[minLon, minLat, maxLon, maxLat]` of the road geometry, or null when empty. */
  bbox: [number, number, number, number] | null;
  validation: ValidationReport;
  /** Buildings tiled, or null when buildings were not requested. */
  buildingCount: number | null;
}

export const NETWORK_FILE = "network.geojson";
export const BUILDINGS_SUBDIR = "buildings";

/** Feature count and coordinate bbox of a GeoJSON FeatureCollection. */
export function featureStats(fc: FeatureCollection): Pick<BuildMapResult, "featureCount" | "bbox"> {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lon, lat] = coords as [number, number];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const c of coords) visit(c);
  };
  for (const feature of fc.features) {
    visit((feature.geometry as { coordinates?: unknown } | null)?.coordinates);
  }
  return {
    featureCount: fc.features.length,
    bbox: minLon === Infinity ? null : [minLon, minLat, maxLon, maxLat],
  };
}

/** Tracks overall progress across the steps that actually run. */
export class ProgressTracker {
  private readonly weights: Partial<Record<BuildStep, number>>;
  private done = 0;

  constructor(
    steps: readonly BuildStep[],
    private readonly emit: (progress: BuildProgress) => void = () => {}
  ) {
    const total = steps.reduce((sum, s) => sum + STEP_WEIGHTS[s], 0);
    this.weights = Object.fromEntries(steps.map((s) => [s, STEP_WEIGHTS[s] / total]));
  }

  /** Reports `fraction` (0..1) of `step`, on top of every step already completed. */
  report(step: BuildStep, fraction: number, extra: Partial<BuildProgress> = {}): void {
    const weight = this.weights[step] ?? 0;
    const progress = Math.min(1, this.done + weight * Math.min(1, Math.max(0, fraction)));
    this.emit({ step, progress: Math.round(progress * 1000) / 1000, ...extra });
  }

  /** Marks `step` finished: later reports start from its end. */
  complete(step: BuildStep): void {
    this.done += this.weights[step] ?? 0;
  }
}

/**
 * Lets queued I/O (progress messages to a parent process) go out between the
 * synchronous steps instead of all at once at the end.
 */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Runs the pipeline. Throws on any failed step; partial output is the caller's to remove. */
export async function buildMap(opts: BuildMapOptions): Promise<BuildMapResult> {
  checkOsmiumAvailable();
  const withBuildings = opts.buildings ?? true;
  const steps = BUILD_STEPS.filter((s) => withBuildings || s !== "buildings");
  const tracker = new ProgressTracker(steps, opts.onProgress);
  const classes = [...(opts.classes ?? DEFAULT_ROAD_CLASSES)];

  /** Announces a step, runs it, and counts it done. */
  const run = async <T>(step: BuildStep, fn: () => T | Promise<T>): Promise<T> => {
    tracker.report(step, 0);
    await tick();
    const value = await fn();
    tracker.complete(step);
    return value;
  };

  fs.mkdirSync(opts.workDir, { recursive: true });
  fs.mkdirSync(opts.outDir, { recursive: true });

  // Download: report bytes at most a few times a second.
  let lastReport = 0;
  await run("download", () =>
    download({
      geofabrik: opts.geofabrik,
      cacheDir: opts.cacheDir,
      onProgress: (received, total) => {
        const now = Date.now();
        if (now - lastReport < 250) return;
        lastReport = now;
        tracker.report("download", total > 0 ? received / total : 0, {
          bytesDownloaded: received,
          ...(total > 0 ? { totalBytes: total } : {}),
        });
      },
    })
  );

  // Intermediates live in the build's own scratch dir, never in the shared cache.
  const pbfCountry = getCachePath(opts.geofabrik, opts.cacheDir);
  const pbfExtracted = path.join(opts.workDir, "extract.osm.pbf");
  const pbfRoads = path.join(opts.workDir, "roads.osm.pbf");
  const output = path.join(opts.outDir, NETWORK_FILE);

  // osmium resolves file arguments against one workdir, so the country file is
  // linked next to the intermediates instead of read across directories.
  const pbfLinked = path.join(opts.workDir, "country.osm.pbf");
  fs.rmSync(pbfLinked, { force: true });
  try {
    fs.symlinkSync(pbfCountry, pbfLinked);
  } catch {
    fs.copyFileSync(pbfCountry, pbfLinked);
  }
  await run("extract", () => extract({ input: pbfLinked, output: pbfExtracted, bbox: opts.bbox }));
  await run("filter", () => filter({ input: pbfExtracted, output: pbfRoads, classes }));
  await run("export", () => {
    exportNetwork({ input: pbfRoads, output, region: opts.regionName, bbox: opts.bbox, classes });
    // The CLI's sidecar metadata; the library keeps its own meta.json.
    fs.rmSync(`${output}.meta.json`, { force: true });
  });
  await run("prune", () => prune(output));

  const { validation, stats } = await run("validate", () => {
    const report = validate(output);
    if (report.totalEdges === 0) throw new Error("No roads found in the requested area");
    if (!report.passed) {
      throw new Error(
        `Network validation failed: largest component ${report.largestComponentPct}% of ` +
          `${report.totalNodes} nodes, ${report.isolatedNodes} isolated`
      );
    }
    const fc = JSON.parse(fs.readFileSync(output, "utf8")) as FeatureCollection;
    return { validation: report, stats: featureStats(fc) };
  });

  let buildingCount: number | null = null;
  if (withBuildings) {
    buildingCount = await run("buildings", async () => {
      const pbfBuildings = path.join(opts.workDir, "buildings.osm.pbf");
      const seqBuildings = path.join(opts.workDir, "buildings.geojson");
      osmium(buildBuildingsFilterArgs({ input: pbfExtracted, output: pbfBuildings }), opts.workDir);
      tracker.report("buildings", 0.3);
      await tick();
      osmium(buildBuildingsExportArgs({ input: pbfBuildings, output: seqBuildings }), opts.workDir);
      tracker.report("buildings", 0.6);
      await tick();
      const builder = await tileBuildings(seqBuildings, new BuildingTileBuilder());
      const dir = path.join(opts.outDir, BUILDINGS_SUBDIR);
      return writeBuildingTiles(dir, builder, opts.regionName).buildings;
    });
  }

  tracker.report(steps[steps.length - 1], 1);
  return { ...stats, validation, buildingCount };
}
