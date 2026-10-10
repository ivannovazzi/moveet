import fs from "fs";
import path from "path";
import readline from "readline";
import { osmium, checkOsmiumAvailable } from "../docker.js";
import { resolveRegion, regionCacheName, type Bbox } from "../regions.js";
import { download, getCachePath } from "./download.js";
import { extract } from "./extract.js";
import { BuildingTileBuilder, type BuildingsIndex } from "./buildingTiles.js";

/**
 * Optional building footprints for the UI's 3D buildings layer.
 *
 * Separate from `prepare` on purpose: the road network is required, buildings
 * are a nice-to-have that triples the processing time and output size. It
 * reuses the same cached country download and bbox extract as `prepare`:
 *
 *   extract (cached) -> tags-filter wr/building -> export polygons (GeoJSON
 *   sequence, streamed) -> tiles + index.json under the output directory
 */

export const DEFAULT_BUILDINGS_OUTPUT = "apps/simulator/data/buildings";
export const BUILDINGS_INDEX_FILE = "index.json";

export function buildBuildingsFilterArgs(opts: { input: string; output: string }): string[] {
  return [
    "tags-filter",
    path.basename(opts.input),
    "wr/building",
    "-o",
    path.basename(opts.output),
    "--overwrite",
  ];
}

export function buildBuildingsExportArgs(opts: { input: string; output: string }): string[] {
  return [
    "export",
    path.basename(opts.input),
    "--geometry-types=polygon",
    // One feature per line, so the (100+ MB) export streams instead of being
    // parsed as one document.
    "--output-format=geojsonseq",
    "--format-option=print_record_separator=false",
    "-o",
    path.basename(opts.output),
    "--overwrite",
  ];
}

const RECORD_SEPARATOR = String.fromCharCode(0x1e);

/** Parse one GeoJSON-sequence line, tolerating a leading RS (0x1e) separator. */
export function parseSeqLine(line: string): Record<string, unknown> | null {
  const trimmed = (line.startsWith(RECORD_SEPARATOR) ? line.slice(1) : line).trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed) as Record<string, unknown>;
}

/** The first vertex of a GeoJSON feature's geometry, or null. */
function firstVertex(feature: Record<string, unknown>): [number, number] | null {
  let c = (feature.geometry as { coordinates?: unknown } | null | undefined)?.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number"
    ? [c[0], c[1]]
    : null;
}

/**
 * Stream a GeoJSON-sequence file into a tile builder. With `bbox`, only
 * buildings that start inside it are kept: the extract hands over whole ways
 * that merely touch the box.
 */
export async function tileBuildings(
  seqPath: string,
  builder: BuildingTileBuilder,
  bbox?: Bbox
): Promise<BuildingTileBuilder> {
  const rl = readline.createInterface({
    input: fs.createReadStream(seqPath, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const feature = parseSeqLine(line);
    if (!feature) continue;
    if (bbox) {
      const at = firstVertex(feature);
      if (!at || at[0] < bbox[0] || at[0] > bbox[2] || at[1] < bbox[1] || at[1] > bbox[3]) {
        continue;
      }
    }
    builder.add(feature as Parameters<BuildingTileBuilder["add"]>[0]);
  }
  return builder;
}

/**
 * Write the tiles and their index. The previous tile tree is removed first so
 * a re-run for a different region leaves no stale tiles behind.
 */
export function writeBuildingTiles(
  outputDir: string,
  builder: BuildingTileBuilder,
  region: string
): BuildingsIndex {
  const zoomDir = path.join(outputDir, String(builder.zoom));
  fs.rmSync(zoomDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [key, tile] of builder.tiles) {
    const file = path.join(zoomDir, `${key}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(tile));
  }
  const index = builder.index(region);
  fs.writeFileSync(path.join(outputDir, BUILDINGS_INDEX_FILE), JSON.stringify(index, null, 2));
  return index;
}

export interface BuildingsOptions {
  region?: string;
  bbox?: Bbox;
  geofabrik?: string;
  output?: string;
  force?: boolean;
  cacheDir: string;
}

function dirSize(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += fs.statSync(path.join(entry.parentPath, entry.name)).size;
  }
  return total;
}

export async function buildings(opts: BuildingsOptions): Promise<BuildingsIndex> {
  checkOsmiumAvailable();
  const region = resolveRegion({ region: opts.region, bbox: opts.bbox, geofabrik: opts.geofabrik });
  const name = regionCacheName(opts.region, region);
  const output = opts.output ?? DEFAULT_BUILDINGS_OUTPUT;

  const pbfCountry = getCachePath(region.geofabrik, opts.cacheDir);
  const pbfExtracted = path.join(opts.cacheDir, `${name}.osm.pbf`);
  const pbfBuildings = path.join(opts.cacheDir, `${name}-buildings.osm.pbf`);
  // `.geojson` so the osmium wrapper resolves it against the workdir; the
  // content is a GeoJSON sequence (see buildBuildingsExportArgs).
  const seqBuildings = path.join(opts.cacheDir, `${name}-buildings.geojson`);

  console.log(`\nPreparing buildings: ${region.label}\n`);
  await download({ geofabrik: region.geofabrik, cacheDir: opts.cacheDir, force: opts.force });
  extract({ input: pbfCountry, output: pbfExtracted, bbox: region.bbox });
  osmium(
    buildBuildingsFilterArgs({ input: pbfExtracted, output: pbfBuildings }),
    path.dirname(pbfExtracted)
  );
  osmium(
    buildBuildingsExportArgs({ input: pbfBuildings, output: seqBuildings }),
    path.dirname(pbfBuildings)
  );

  const builder = await tileBuildings(seqBuildings, new BuildingTileBuilder());
  const index = writeBuildingTiles(output, builder, opts.region ?? "custom");
  const mb = (dirSize(output) / 1024 / 1024).toFixed(1);
  console.log(
    `\nBuildings: ${index.buildings.toLocaleString()} in ${index.tiles.length} tiles ` +
      `(z${index.zoom}), ${mb} MB, skipped ${builder.skipped} degenerate rings`
  );
  console.log(`Buildings ready: ${output}\n`);
  return index;
}
