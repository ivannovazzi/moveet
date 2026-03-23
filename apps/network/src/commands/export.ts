import fs from "fs";
import path from "path";
import type { Bbox } from "../regions.js";
import { osmium } from "../docker.js";

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

  if (path.resolve(tempOutput) !== path.resolve(opts.output)) {
    fs.renameSync(tempOutput, opts.output);
  }

  fs.writeFileSync(
    `${opts.output}.meta.json`,
    JSON.stringify(buildMetadata(opts), null, 2),
  );
}
