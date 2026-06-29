import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { resolveRegion, listRegions } from "../regions.js";
import { checkOsmiumAvailable } from "../docker.js";
import { download, getCachePath } from "./download.js";
import { extract } from "./extract.js";
import { filter, DEFAULT_ROAD_CLASSES } from "./filter.js";
import { exportNetwork } from "./export.js";
import { prune } from "./prune.js";
import { validate } from "./validate.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// commands/ lives one level below src/, .cache sits at the app root → ../../
const DEFAULT_CACHE_DIR = path.resolve(__dirname, "../../.cache");
const DEFAULT_OUTPUT = "apps/simulator/data/network.geojson";

export interface PrepareOptions {
  region?: string;
  bbox?: [number, number, number, number];
  geofabrik?: string;
  output?: string;
  classes?: string[];
  force?: boolean;
  dryRun?: boolean;
  cacheDir?: string;
}

export async function prepare(opts: PrepareOptions): Promise<void> {
  checkOsmiumAvailable();

  const CACHE_DIR = opts.cacheDir ?? DEFAULT_CACHE_DIR;

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
  // Named regions key the cache by name; custom (bbox) runs key by a short
  // hash of geofabrik + bbox so distinct custom areas don't collide on
  // "custom.osm.pbf".
  const safeName = resolvedOpts.region
    ? regionName.replace(/[^a-z0-9-]/g, "-")
    : `custom-${crypto
        .createHash("sha1")
        .update(`${region.geofabrik}|${region.bbox.join(",")}`)
        .digest("hex")
        .slice(0, 8)}`;

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

  await download({
    geofabrik: region.geofabrik,
    cacheDir: CACHE_DIR,
    force: opts.force,
  });
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
