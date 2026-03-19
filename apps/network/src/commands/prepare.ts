import path from "path";
import { resolveRegion, listRegions } from "../regions.js";
import { checkDockerAvailable } from "../docker.js";
import { download, getCachePath } from "./download.js";
import { extract } from "./extract.js";
import { filter, DEFAULT_ROAD_CLASSES } from "./filter.js";
import { exportNetwork } from "./export.js";
import { prune } from "./prune.js";
import { validate } from "./validate.js";

const CACHE_DIR = path.resolve("apps/network/.cache");
const DEFAULT_OUTPUT = "apps/simulator/data/network.geojson";

export interface PrepareOptions {
  region?: string;
  bbox?: [number, number, number, number];
  geofabrik?: string;
  output?: string;
  classes?: string[];
  force?: boolean;
  dryRun?: boolean;
}

export async function prepare(opts: PrepareOptions): Promise<void> {
  checkDockerAvailable();

  let resolvedOpts = { ...opts };

  // Interactive mode only when region not provided
  if (!opts.region && !opts.bbox) {
    const { default: inquirer } = await import("inquirer");
    const regions = listRegions();

    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "region",
        message: "Select a region:",
        choices: regions,
      },
      {
        type: "input",
        name: "output",
        message: "Output path:",
        default: DEFAULT_OUTPUT,
      },
      {
        type: "checkbox",
        name: "classes",
        message: "Road classes to include:",
        choices: [...DEFAULT_ROAD_CLASSES].map((c) => ({
          name: c,
          value: c,
          checked: true,
        })),
      },
    ]);

    resolvedOpts = { ...resolvedOpts, ...answers };
  }

  const region = resolveRegion({
    region: resolvedOpts.region,
    bbox: resolvedOpts.bbox,
    geofabrik: resolvedOpts.geofabrik,
  });

  const output = resolvedOpts.output ?? DEFAULT_OUTPUT;
  const classes = resolvedOpts.classes ?? [...DEFAULT_ROAD_CLASSES];
  const regionName = resolvedOpts.region ?? "custom";
  const safeName = regionName.replace(/[^a-z0-9-]/g, "-");

  // Derive cache file paths from geofabrik path + region name
  const pbfCountry = getCachePath(region.geofabrik, CACHE_DIR);
  const pbfExtracted = path.join(CACHE_DIR, `${safeName}.osm.pbf`);
  const pbfFiltered = path.join(CACHE_DIR, `${safeName}-roads.osm.pbf`);

  if (opts.dryRun) {
    console.log("\nDry run — pipeline steps:");
    console.log(`  1. download  ${region.geofabrik} → ${pbfCountry}`);
    console.log(`  2. extract   bbox [${region.bbox.join(", ")}] → ${pbfExtracted}`);
    console.log(`  3. filter    classes: ${classes.join(",")} → ${pbfFiltered}`);
    console.log(`  4. export    → ${output}`);
    console.log(`  5. prune     keep largest connected component`);
    console.log(`  6. validate  ${output}\n`);
    return;
  }

  console.log(`\nPreparing network: ${region.label}\n`);

  await download({ geofabrik: region.geofabrik, cacheDir: CACHE_DIR, force: opts.force });
  extract({ input: pbfCountry, output: pbfExtracted, bbox: region.bbox });
  filter({ input: pbfExtracted, output: pbfFiltered, classes });
  exportNetwork({
    input: pbfFiltered,
    output,
    region: regionName,
    bbox: region.bbox,
    classes,
  });
  prune(output);
  const report = validate(output);

  if (!report.passed) {
    console.error("Validation failed — see report above");
    process.exit(1);
  }

  console.log(`\nNetwork ready: ${output}\n`);
}
