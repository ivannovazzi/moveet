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
      throw new Error(
        `Unknown region: ${opts.region}. Known regions: ${listRegions().join(", ")}`,
      );
    }
    return entry;
  }
  throw new Error("Provide --region or --bbox + --geofabrik");
}

export function listRegions(): string[] {
  return Object.keys(manifest).sort();
}
