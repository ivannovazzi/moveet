#!/usr/bin/env node
import { Command } from "commander";
import { resolveRegion, parseBbox } from "./regions.js";
import { download } from "./commands/download.js";
import { extract } from "./commands/extract.js";
import { filter, DEFAULT_ROAD_CLASSES } from "./commands/filter.js";
import { exportNetwork } from "./commands/export.js";
import { prune } from "./commands/prune.js";
import { validate } from "./commands/validate.js";
import { diff } from "./commands/diff.js";
import { prepare } from "./commands/prepare.js";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = "apps/simulator/data/network.geojson";

const CACHE_DIR = path.resolve(__dirname, "../.cache");

const program = new Command();

program.name("network").description("OSM road network data pipeline for Moveet").version("0.1.0");

program
  .command("download")
  .description("Download OSM PBF from Geofabrik")
  .option("-r, --region <name>", "Known region name")
  .option("--bbox <w,s,e,n>", "Custom bounding box (west,south,east,north)")
  .option("--geofabrik <path>", "Geofabrik path (e.g. africa/kenya)")
  .option("--force", "Re-download even if cached")
  .action(async (opts: { region?: string; bbox?: string; geofabrik?: string; force?: boolean }) => {
    const region = resolveRegion({
      region: opts.region,
      bbox: opts.bbox ? parseBbox(opts.bbox) : undefined,
      geofabrik: opts.geofabrik,
    });
    await download({
      geofabrik: region.geofabrik,
      cacheDir: CACHE_DIR,
      force: opts.force,
    });
  });

program
  .command("extract")
  .description("Extract bbox from country PBF using osmium")
  .requiredOption("--input <path>", "Input country PBF file")
  .requiredOption("--output <path>", "Output extracted PBF file")
  .requiredOption("--bbox <w,s,e,n>", "Bounding box as west,south,east,north")
  .action((opts: { input: string; output: string; bbox: string }) => {
    extract({
      input: opts.input,
      output: opts.output,
      bbox: parseBbox(opts.bbox),
    });
  });

program
  .command("filter")
  .description("Filter road classes from PBF using osmium")
  .requiredOption("--input <path>", "Input PBF file")
  .requiredOption("--output <path>", "Output filtered PBF file")
  .option("--classes <list>", "Comma-separated road classes", [...DEFAULT_ROAD_CLASSES].join(","))
  .action((opts: { input: string; output: string; classes: string }) => {
    filter({
      input: opts.input,
      output: opts.output,
      classes: opts.classes.split(","),
    });
  });

program
  .command("export")
  .description("Export filtered PBF to GeoJSON using osmium")
  .requiredOption("--input <path>", "Input filtered roads PBF file")
  .option("--output <path>", "Output GeoJSON path", "apps/simulator/data/network.geojson")
  .option("--region <name>", "Region name for metadata", "unknown")
  .action((opts: { input: string; output: string; region: string }) => {
    exportNetwork({
      input: opts.input,
      output: opts.output,
      region: opts.region,
      bbox: [0, 0, 0, 0],
      classes: [],
    });
  });

program
  .command("prune")
  .description("Remove disconnected components, keeping only the largest")
  .requiredOption("--input <path>", "GeoJSON file to prune")
  .option("--output <path>", "Output path (defaults to overwriting input)")
  .action((opts: { input: string; output?: string }) => {
    prune(opts.input, opts.output);
  });

program
  .command("validate")
  .description("Run topology validation on a network GeoJSON")
  .requiredOption("--input <path>", "GeoJSON file to validate")
  .action((opts: { input: string }) => {
    const report = validate(opts.input);
    if (!report.passed) process.exit(1);
  });

program
  .command("diff <old> <new>")
  .description("Compare two network GeoJSON files")
  .action((oldPath: string, newPath: string) => {
    const result = diff(oldPath, newPath);
    if (!result.identical) process.exit(1);
  });

program
  .command("prepare [region]")
  .description("Full pipeline: download → extract → filter → export → validate")
  .option("--bbox <w,s,e,n>", "Custom bounding box (west,south,east,north)")
  .option("--geofabrik <path>", "Geofabrik path (e.g. africa/kenya)")
  .option("--output <path>", "Output GeoJSON path", DEFAULT_OUTPUT)
  .option("--force", "Force re-download even if cached")
  .option("--dry-run", "Print pipeline steps without executing")
  .action(
    async (
      region: string | undefined,
      opts: {
        bbox?: string;
        geofabrik?: string;
        output: string;
        force?: boolean;
        dryRun?: boolean;
      }
    ) => {
      await prepare({
        region,
        bbox: opts.bbox ? parseBbox(opts.bbox) : undefined,
        geofabrik: opts.geofabrik,
        output: opts.output,
        force: opts.force,
        dryRun: opts.dryRun,
        cacheDir: CACHE_DIR,
      });
    }
  );

export async function runCLI(): Promise<void> {
  await program.parseAsync();
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCLI().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
