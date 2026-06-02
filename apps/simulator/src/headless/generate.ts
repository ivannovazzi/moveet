import path from "path";
import { config } from "../utils/config";
import { createLogger } from "../utils/logger";
import { HeadlessRunner } from "./HeadlessRunner";

const log = createLogger("generate");

interface ParsedArgs {
  hours?: number;
  steps?: number;
  vehicles: number;
  start: Date;
  stepMs: number;
  out: string;
  seed: number;
  geojsonPath: string;
  network: string;
}

/**
 * Parses `--flag=value` and `--flag value` style CLI arguments.
 */
function parseArgs(argv: string[]): ParsedArgs {
  const raw: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      raw[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        raw[key] = next;
        i++;
      } else {
        raw[key] = "true";
      }
    }
  }

  const stepMs = raw.step !== undefined ? Number(raw.step) : 1000;
  if (!Number.isFinite(stepMs) || stepMs <= 0) {
    throw new Error(`--step must be a positive number of ms (got "${raw.step}")`);
  }

  const vehicles = raw.vehicles !== undefined ? Number(raw.vehicles) : config.vehicleCount;
  if (!Number.isInteger(vehicles) || vehicles <= 0) {
    throw new Error(`--vehicles must be a positive integer (got "${raw.vehicles}")`);
  }

  const start =
    raw.start !== undefined ? new Date(raw.start) : new Date("2026-05-25T00:00:00.000Z");
  if (Number.isNaN(start.getTime())) {
    throw new Error(`--start must be a valid ISO date (got "${raw.start}")`);
  }

  const hours = raw.hours !== undefined ? Number(raw.hours) : undefined;
  const steps = raw.steps !== undefined ? Number(raw.steps) : undefined;
  if (hours !== undefined && (!Number.isFinite(hours) || hours <= 0)) {
    throw new Error(`--hours must be a positive number (got "${raw.hours}")`);
  }
  if (steps !== undefined && (!Number.isInteger(steps) || steps <= 0)) {
    throw new Error(`--steps must be a positive integer (got "${raw.steps}")`);
  }

  const seed = raw.seed !== undefined ? Number(raw.seed) : 12345;
  if (!Number.isFinite(seed)) {
    throw new Error(`--seed must be a number (got "${raw.seed}")`);
  }

  const out = raw.out ?? "truth.ndjson";
  const geojsonPath = raw.geojson ?? config.geojsonPath;
  const network = raw.network ?? "nairobi";

  return { hours, steps, vehicles, start, stepMs, out, seed, geojsonPath, network };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // Resolve total simulated duration: --steps wins, else --hours, else default 1h.
  let totalSimMs: number;
  if (args.steps !== undefined) {
    totalSimMs = args.steps * args.stepMs;
  } else if (args.hours !== undefined) {
    totalSimMs = args.hours * 60 * 60 * 1000;
  } else {
    totalSimMs = 60 * 60 * 1000; // default: 1 hour
  }

  const out = path.resolve(args.out);

  const runner = new HeadlessRunner({
    geojsonPath: args.geojsonPath,
    vehicles: args.vehicles,
    simStart: args.start,
    stepMs: args.stepMs,
    totalSimMs,
    out,
    seed: args.seed,
    network: args.network,
  });

  const t0 = Date.now();
  runner.run();
  log.info(`Generation completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

try {
  main();
} catch (err) {
  log.error(`Generation failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
