import crypto from "crypto";
import { z } from "zod";
// A static JSON import (not a runtime require relative to this file) so the
// manifest is inlined when the simulator bundles this module with esbuild.
import raw from "../regions.json" with { type: "json" };

const Coord = z.number().refine(Number.isFinite, "must be a finite number");
export const BboxSchema = z.tuple([Coord, Coord, Coord, Coord]);

/**
 * Parse a "west,south,east,north" string into a validated bbox tuple.
 * Rejects the wrong number of components or any non-finite value (NaN),
 * so bad input fails fast instead of flowing into osmium.
 */
export function parseBbox(raw: string): Bbox {
  return BboxSchema.parse(raw.split(",").map(Number));
}

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

const manifest = z.record(z.string(), RegionEntrySchema).parse(raw);

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
      throw new Error(`Unknown region: ${opts.region}. Known regions: ${listRegions().join(", ")}`);
    }
    return entry;
  }
  throw new Error("Provide --region or --bbox + --geofabrik");
}

export function listRegions(): string[] {
  return Object.keys(manifest).sort();
}

/** Every named region (`regions.json`), keyed by name. */
export function presetRegions(): Record<string, ResolvedRegion> {
  return { ...manifest };
}

/**
 * File-name stem for a region's cached extracts (`<stem>.osm.pbf`,
 * `<stem>-roads.osm.pbf`, ...). Named regions key the cache by name; custom
 * (bbox) runs key by a short hash of geofabrik + bbox so distinct custom areas
 * don't collide on "custom.osm.pbf". Shared by `prepare` and `buildings`, so
 * both reuse the same bbox extract.
 */
export function regionCacheName(regionKey: string | undefined, region: ResolvedRegion): string {
  if (regionKey) return regionKey.replace(/[^a-z0-9-]/g, "-");
  const hash = crypto
    .createHash("sha1")
    .update(`${region.geofabrik}|${region.bbox.join(",")}`)
    .digest("hex")
    .slice(0, 8);
  return `custom-${hash}`;
}
