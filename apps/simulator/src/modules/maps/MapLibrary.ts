import fs from "fs";
import path from "path";
import type { MapMeta, MapSource } from "@moveet/shared-types";
import logger from "../../utils/logger";

/**
 * On-disk library of road networks the simulator can run on.
 *
 * Layout under the root (`MAPS_DIR`):
 *
 *   <id>/network.geojson   the road network, as written by `apps/network`
 *   <id>/buildings/        optional 3D building tiles (`index.json` + z/x/y.json)
 *   <id>/meta.json         {@link MapMeta}
 *   state.json             `{ "activeId": "<id>" }`, so the choice survives restarts
 *
 * The library only stores and describes maps; loading one into the running
 * simulation is {@link MapSwitcher}'s job.
 */

export const NETWORK_FILE = "network.geojson";
export const BUILDINGS_SUBDIR = "buildings";
export const META_FILE = "meta.json";
export const STATE_FILE = "state.json";

/** Lowercase, path-safe, and short: the id is a directory name and a URL segment. */
const MAP_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function isValidMapId(id: string): boolean {
  return MAP_ID.test(id);
}

/** Turns a free-form name (a file stem, a region) into a valid map id. */
export function slugifyMapId(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return slug || "map";
}

export interface ImportMapInput {
  /** Requested id; made unique (`-2`, `-3`, ...) when already taken. */
  id: string;
  label: string;
  /** GeoJSON file to copy in as `network.geojson`. */
  networkPath: string;
  /** Optional building tile directory to copy in as `buildings/`. */
  buildingsDir?: string;
  source: MapSource;
  attribution?: string;
}

/** A map a build job wrote into a staging directory, to be added to the library. */
export interface AddBuiltMapInput {
  /** Requested id; made unique (`-2`, `-3`, ...) when already taken. */
  id: string;
  label: string;
  /** Holds `network.geojson` and optionally `buildings/`; moved into the library. */
  stagingDir: string;
  source: MapSource;
  bbox: MapMeta["bbox"];
  featureCount: number;
  buildingCount?: number;
  attribution?: string;
}

/** Where startup finds maps when the library is empty. */
export interface MigrationSources {
  /** Pre-library network (`data/network.geojson`), imported when present. */
  legacyNetworkPath?: string;
  /** Pre-library building tiles (`data/buildings`), imported with it. */
  legacyBuildingsDir?: string;
  /**
   * Small default map shipped with the simulator, the last resort. A
   * `meta.json` beside it may give its `label` and `attribution`.
   */
  bundledNetworkPath?: string;
}

interface GeoJsonStats {
  featureCount: number;
  bbox: [number, number, number, number] | null;
}

/** Feature count and coordinate bbox of a GeoJSON FeatureCollection. */
export function geoJsonStats(data: unknown): GeoJsonStats {
  const features = (data as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) {
    throw new Error("Not a GeoJSON FeatureCollection (no features array)");
  }
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  const visit = (coords: unknown): void => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      const [lon, lat] = coords as [number, number];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      return;
    }
    for (const c of coords) visit(c);
  };
  for (const feature of features) {
    visit((feature as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates);
  }
  const bbox: GeoJsonStats["bbox"] = minLon === Infinity ? null : [minLon, minLat, maxLon, maxLat];
  return { featureCount: features.length, bbox };
}

export function directoryBytes(dir: string): number {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directoryBytes(full);
    else if (entry.isFile()) total += fs.statSync(full).size;
  }
  return total;
}

/** `label`/`attribution` from the bundled map's sidecar `meta.json`, when present and readable. */
function readBundledMeta(file: string): { label?: string; attribution?: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    return {
      ...(typeof raw.label === "string" ? { label: raw.label } : {}),
      ...(typeof raw.attribution === "string" ? { attribution: raw.attribution } : {}),
    };
  } catch {
    return {};
  }
}

/** Write via a temp file + rename so a crash never leaves a half-written file. */
function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

export class MapLibrary {
  readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  // ─── Paths ────────────────────────────────────────────────────────

  mapDir(id: string): string {
    if (!isValidMapId(id)) throw new Error(`Invalid map id: ${id}`);
    return path.join(this.root, id);
  }

  networkPath(id: string): string {
    return path.join(this.mapDir(id), NETWORK_FILE);
  }

  /** The map's building tile directory, or null when it has none. */
  buildingsDir(id: string): string | null {
    const dir = path.join(this.mapDir(id), BUILDINGS_SUBDIR);
    return fs.existsSync(dir) ? dir : null;
  }

  // ─── Queries ──────────────────────────────────────────────────────

  has(id: string): boolean {
    return isValidMapId(id) && fs.existsSync(path.join(this.root, id, NETWORK_FILE));
  }

  get(id: string): MapMeta | null {
    if (!this.has(id)) return null;
    const metaPath = path.join(this.root, id, META_FILE);
    try {
      if (!fs.existsSync(metaPath)) return this.describe(id);
      const meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as MapMeta;
      // The directory name is the id, whatever the file says.
      return { ...meta, id };
    } catch (err) {
      logger.warn(`Map ${id} has no readable ${META_FILE}: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Writes meta for a map directory created by hand (a `network.geojson`
   * dropped into `<MAPS_DIR>/<id>/`), so it shows up like any other map.
   */
  private describe(id: string): MapMeta {
    const networkPath = this.networkPath(id);
    const raw = fs.readFileSync(networkPath, "utf8");
    const stats = geoJsonStats(JSON.parse(raw));
    const buildings = this.buildingsDir(id);
    const meta: MapMeta = {
      id,
      label: id,
      bbox: stats.bbox,
      source: { type: "import", from: path.join(id, NETWORK_FILE) },
      sizes: {
        networkBytes: Buffer.byteLength(raw),
        buildingsBytes: buildings ? directoryBytes(buildings) : 0,
      },
      featureCount: stats.featureCount,
      nodeCount: null,
      hasBuildings: !!buildings,
      createdAt: fs.statSync(networkPath).mtime.toISOString(),
    };
    writeJsonAtomic(path.join(this.mapDir(id), META_FILE), meta);
    logger.info(`Described hand-added map "${id}"`);
    return meta;
  }

  /** Every readable map, oldest first. */
  list(): MapMeta[] {
    if (!fs.existsSync(this.root)) return [];
    const maps: MapMeta[] = [];
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !isValidMapId(entry.name)) continue;
      const meta = this.get(entry.name);
      if (meta) maps.push(meta);
    }
    return maps.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  // ─── Active map state ─────────────────────────────────────────────

  /** The persisted active id, or null when unset or pointing at a missing map. */
  getActiveId(): string | null {
    try {
      const state = JSON.parse(fs.readFileSync(path.join(this.root, STATE_FILE), "utf8")) as {
        activeId?: unknown;
      };
      return typeof state.activeId === "string" && this.has(state.activeId) ? state.activeId : null;
    } catch {
      return null;
    }
  }

  /** `network.geojson` of the persisted active map, or null when none is set. */
  activeNetworkPath(): string | null {
    const id = this.getActiveId();
    return id ? this.networkPath(id) : null;
  }

  setActiveId(id: string): void {
    if (!this.has(id)) throw new Error(`Unknown map: ${id}`);
    fs.mkdirSync(this.root, { recursive: true });
    writeJsonAtomic(path.join(this.root, STATE_FILE), { activeId: id });
  }

  // ─── Mutations ────────────────────────────────────────────────────

  /**
   * Copies a network (and optional buildings) into a new library entry and
   * writes its meta. The source files are left untouched.
   */
  importMap(input: ImportMapInput): MapMeta {
    const raw = fs.readFileSync(input.networkPath, "utf8");
    const stats = geoJsonStats(JSON.parse(raw));

    const id = this.uniqueId(slugifyMapId(input.id));
    const dir = this.mapDir(id);
    // Stage in a sibling temp dir and rename, so a half-copied map never shows
    // up in the listing.
    const staging = path.join(this.root, `.${id}.${process.pid}.tmp`);
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    try {
      fs.writeFileSync(path.join(staging, NETWORK_FILE), raw);
      let buildingsBytes = 0;
      const hasBuildings = !!input.buildingsDir && fs.existsSync(input.buildingsDir);
      if (hasBuildings) {
        const target = path.join(staging, BUILDINGS_SUBDIR);
        fs.cpSync(input.buildingsDir as string, target, { recursive: true });
        buildingsBytes = directoryBytes(target);
      }
      const meta: MapMeta = {
        id,
        label: input.label,
        bbox: stats.bbox,
        source: input.source,
        sizes: { networkBytes: Buffer.byteLength(raw), buildingsBytes },
        featureCount: stats.featureCount,
        nodeCount: null,
        hasBuildings,
        ...(input.attribution ? { attribution: input.attribution } : {}),
        createdAt: new Date().toISOString(),
      };
      writeJsonAtomic(path.join(staging, META_FILE), meta);
      fs.renameSync(staging, dir);
      return meta;
    } catch (err) {
      fs.rmSync(staging, { recursive: true, force: true });
      throw err;
    }
  }

  /**
   * Moves a staged build into the library under a unique id and writes its
   * meta. The staging directory must sit on the same filesystem (inside the
   * library root) so the move is an atomic rename.
   */
  addBuiltMap(input: AddBuiltMapInput): MapMeta {
    const network = path.join(input.stagingDir, NETWORK_FILE);
    if (!fs.existsSync(network)) throw new Error(`Build produced no ${NETWORK_FILE}`);
    const buildings = path.join(input.stagingDir, BUILDINGS_SUBDIR);
    const hasBuildings = fs.existsSync(buildings);
    const id = this.uniqueId(slugifyMapId(input.id));
    const meta: MapMeta = {
      id,
      label: input.label,
      bbox: input.bbox,
      source: input.source,
      sizes: {
        networkBytes: fs.statSync(network).size,
        buildingsBytes: hasBuildings ? directoryBytes(buildings) : 0,
      },
      featureCount: input.featureCount,
      nodeCount: null,
      hasBuildings,
      ...(input.buildingCount !== undefined ? { buildingCount: input.buildingCount } : {}),
      ...(input.attribution ? { attribution: input.attribution } : {}),
      createdAt: new Date().toISOString(),
    };
    writeJsonAtomic(path.join(input.stagingDir, META_FILE), meta);
    fs.renameSync(input.stagingDir, this.mapDir(id));
    return meta;
  }

  /** Bytes used by the library's maps: every map directory, nothing hidden (no cache, no staging). */
  usedBytes(): number {
    if (!fs.existsSync(this.root)) return 0;
    let total = 0;
    for (const entry of fs.readdirSync(this.root, { withFileTypes: true })) {
      if (entry.isDirectory() && isValidMapId(entry.name)) {
        total += directoryBytes(path.join(this.root, entry.name));
      }
    }
    return total;
  }

  /** Merges `patch` into a map's meta. Returns the updated meta, or null if unknown. */
  updateMeta(id: string, patch: Partial<Omit<MapMeta, "id">>): MapMeta | null {
    const meta = this.get(id);
    if (!meta) return null;
    const next = { ...meta, ...patch, id };
    writeJsonAtomic(path.join(this.mapDir(id), META_FILE), next);
    return next;
  }

  /** Deletes a map's directory. The caller guards against removing the active map. */
  remove(id: string): boolean {
    if (!this.has(id)) return false;
    fs.rmSync(this.mapDir(id), { recursive: true, force: true });
    return true;
  }

  // ─── Startup ──────────────────────────────────────────────────────

  /**
   * Creates the library when missing and, when it holds no maps, seeds it:
   * first from the pre-library `data/network.geojson` (+ `data/buildings/`) so
   * an existing local setup keeps its city, otherwise from the bundled default.
   * Returns the id to activate: the persisted one, else the oldest map.
   *
   * @throws when the library is empty and there is nothing to seed it from.
   */
  initialize(sources: MigrationSources = {}): string {
    fs.mkdirSync(this.root, { recursive: true });

    if (this.list().length === 0) {
      const { legacyNetworkPath, legacyBuildingsDir, bundledNetworkPath } = sources;
      if (legacyNetworkPath && fs.existsSync(legacyNetworkPath)) {
        const meta = this.importMap({
          id: "imported",
          label: "Imported network",
          networkPath: legacyNetworkPath,
          buildingsDir: legacyBuildingsDir,
          // Relative: an absolute host or container path says nothing useful.
          source: { type: "import", from: path.relative(process.cwd(), legacyNetworkPath) },
        });
        logger.info(`Imported ${legacyNetworkPath} into the map library as "${meta.id}"`);
      } else if (bundledNetworkPath && fs.existsSync(bundledNetworkPath)) {
        const sidecar = readBundledMeta(path.join(path.dirname(bundledNetworkPath), META_FILE));
        const meta = this.importMap({
          id: "demo",
          label: sidecar.label ?? "Demo map (bundled)",
          networkPath: bundledNetworkPath,
          source: { type: "bundled" },
          ...(sidecar.attribution ? { attribution: sidecar.attribution } : {}),
        });
        logger.warn(
          `Map library is empty; using the bundled demo map "${meta.id}". ` +
            "Add a city map to the library to simulate a real road network."
        );
      }
    }

    const active = this.getActiveId() ?? this.list()[0]?.id;
    if (!active) {
      throw new Error(
        `Map library ${this.root} is empty and there is no network to import. ` +
          "Generate one with `npx tsx apps/network/src/cli.ts prepare <region>`."
      );
    }
    this.setActiveId(active);
    return active;
  }

  private uniqueId(base: string): string {
    if (!fs.existsSync(path.join(this.root, base))) return base;
    for (let n = 2; ; n++) {
      const suffix = `-${n}`;
      const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
      if (!fs.existsSync(path.join(this.root, candidate))) return candidate;
    }
  }
}
