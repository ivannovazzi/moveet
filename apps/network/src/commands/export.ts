import fs from "fs";
import path from "path";
import type { FeatureCollection } from "geojson";
import type { Bbox } from "../regions.js";
import { osmium } from "../docker.js";
import { appendRestrictions, extractRestrictions } from "./restrictions.js";

export interface ExportCoreOptions {
  input: string;
  output: string;
}

export interface MetadataOptions {
  region: string;
  bbox: Bbox;
  classes: string[];
}

export type ExportOptions = ExportCoreOptions & MetadataOptions;

export function buildExportArgs(opts: ExportCoreOptions): string[] {
  return [
    "export",
    path.basename(opts.input),
    "--geometry-types=linestring,point",
    // Stamp each feature's OSM id as `@id`: the simulator uses a way's id as its
    // street id, which is what turn-restriction relations reference.
    "--attributes=id",
    "--output-format=geojson",
    "-o",
    path.basename(opts.output),
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

export function exportNetwork(opts: ExportOptions): void {
  fs.mkdirSync(path.dirname(opts.output), { recursive: true });

  // osmium writes relative to workdir; use cache dir as workdir, copy out if needed
  const workdir = path.dirname(opts.input);
  const tempOutput = path.join(workdir, path.basename(opts.output));

  osmium(buildExportArgs({ input: opts.input, output: tempOutput }), workdir);

  // `osmium export` only writes geometries, so restriction relations are
  // extracted separately and appended as Point features at their via node.
  const restrictions = extractRestrictions(opts.input);
  const fc = JSON.parse(fs.readFileSync(tempOutput, "utf8")) as FeatureCollection;
  fs.writeFileSync(tempOutput, JSON.stringify(appendRestrictions(fc, restrictions.features)));
  const { viaWay, missingViaNode, ambiguous } = restrictions.skipped;
  console.log(
    `\nTurn restrictions: kept ${restrictions.features.length.toLocaleString()}, ` +
      `skipped ${viaWay} via-way, ${missingViaNode} missing via node, ${ambiguous} multi-member`
  );

  if (path.resolve(tempOutput) !== path.resolve(opts.output)) {
    fs.renameSync(tempOutput, opts.output);
  }

  fs.writeFileSync(`${opts.output}.meta.json`, JSON.stringify(buildMetadata(opts), null, 2));
}
