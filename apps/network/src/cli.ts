#!/usr/bin/env node
import { Command } from "commander";
import { resolveRegion } from "./regions.js";
import { download } from "./commands/download.js";
import path from "path";

const CACHE_DIR = path.resolve("apps/network/.cache");

const program = new Command();

program
  .name("network")
  .description("OSM road network data pipeline for Moveet")
  .version("0.1.0");

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
      bbox: opts.bbox
        ? (opts.bbox.split(",").map(Number) as [number, number, number, number])
        : undefined,
      geofabrik: opts.geofabrik,
    });
    await download({
      geofabrik: region.geofabrik,
      cacheDir: CACHE_DIR,
      force: opts.force,
    });
  });

program.parse();

export function runCLI(): void {
  program.parse();
}
