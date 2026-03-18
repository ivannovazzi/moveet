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
  osmium(buildExtractArgs(opts), path.dirname(opts.input));
}
