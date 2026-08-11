import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { scenarioSchema } from "../modules/scenario/types";
import type { Scenario } from "../modules/scenario/types";
import { config } from "../utils/config";
import { ScenarioRunner } from "./ScenarioRunner";
import type { ScenarioRunReport } from "./ScenarioRunner";

/** Where a bare scenario name (`rush-hour`) is looked up. */
const SCENARIOS_DIR = path.resolve("data/scenarios");

/** Exit codes. 1 = the scenario ran and failed; 2 = it could not be run. */
export const EXIT_PASS = 0;
export const EXIT_ASSERTION_FAILURE = 1;
export const EXIT_USAGE = 2;

const USAGE = `Usage: npm run scenario -- <scenario.json|name> [options]

Runs a scenario headlessly on simulated time and grades it against the
assertions in the file. Exits ${EXIT_ASSERTION_FAILURE} when an assertion fails
(or a scenario action threw), ${EXIT_USAGE} when the scenario could not be run.

Options:
  --vehicles <n>      Synthetic vehicles seeded before the timeline (default 0)
  --step-ms <n>       Simulated ms per step (default 1000)
  --seed <n>          RNG seed (default 1)
  --max-seconds <n>   Cap simulated seconds, overriding the scenario duration
  --network <path>    GeoJSON road network (default: the configured one)
  --report <path>     Write the full JSON report to a file
  --json              Print the JSON report to stdout instead of a summary
  -h, --help          Show this help
`;

interface CliOptions {
  file: string;
  vehicles?: number;
  stepMs?: number;
  seed?: number;
  maxSeconds?: number;
  network?: string;
  report?: string;
  json: boolean;
}

/** Thrown for anything the user can fix by re-running with different input. */
class UsageError extends Error {}

export function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  const opts: Partial<CliOptions> = { json: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const numeric = (name: string): number => {
      const raw = argv[++i];
      const value = Number(raw);
      if (raw === undefined || !Number.isFinite(value)) {
        throw new UsageError(`${name} requires a number`);
      }
      return value;
    };
    const text = (name: string): string => {
      const raw = argv[++i];
      if (raw === undefined) throw new UsageError(`${name} requires a value`);
      return raw;
    };

    switch (arg) {
      case "--vehicles":
        opts.vehicles = numeric(arg);
        break;
      case "--step-ms":
        opts.stepMs = numeric(arg);
        break;
      case "--seed":
        opts.seed = numeric(arg);
        break;
      case "--max-seconds":
        opts.maxSeconds = numeric(arg);
        break;
      case "--network":
        opts.network = text(arg);
        break;
      case "--report":
        opts.report = text(arg);
        break;
      case "--json":
        opts.json = true;
        break;
      case "-h":
      case "--help":
        throw new UsageError(USAGE);
      default:
        if (arg.startsWith("-")) throw new UsageError(`Unknown option: ${arg}`);
        positional.push(arg);
    }
  }

  if (positional.length === 0) throw new UsageError(USAGE);
  if (positional.length > 1) {
    throw new UsageError(`Expected one scenario file, got ${positional.length}`);
  }

  return { ...opts, file: positional[0], json: opts.json ?? false };
}

/**
 * Resolves a scenario argument to a readable path: an explicit path as given,
 * or a bare name looked up in `data/scenarios` (with or without `.json`).
 */
export function resolveScenarioPath(file: string): string {
  const candidates = [
    file,
    path.join(SCENARIOS_DIR, file),
    path.join(SCENARIOS_DIR, `${file}.json`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
  }
  throw new UsageError(`Scenario not found: ${file} (looked in ., ${SCENARIOS_DIR})`);
}

function formatSummary(report: ScenarioRunReport): string {
  const lines: string[] = [];
  const { scenario, metrics } = report;

  lines.push(`Scenario: ${scenario.name}`);
  lines.push(
    `  ${report.simSeconds}s simulated in ${report.wallMs}ms wall, ` +
      `${report.eventsExecuted}/${scenario.eventCount} events, seed ${report.seed}`
  );
  lines.push(
    `  Vehicles: ${metrics.vehicles.count}, ` +
      `avg ${metrics.vehicles.avgSpeedKph.toFixed(1)} km/h, ` +
      `${metrics.vehicles.totalDistanceKm.toFixed(2)} km driven`
  );
  lines.push(
    `  Jobs: ${metrics.jobs.total} created, ${metrics.jobs.complete} complete, ` +
      `${metrics.jobs.failed} failed, ${metrics.jobs.cancelled} cancelled, ` +
      `${metrics.jobs.unfinished} unfinished`
  );

  for (const error of report.eventErrors) {
    lines.push(`  ERROR at ${error.at}s (${error.action}): ${error.error}`);
  }

  if (report.assertions.length === 0) {
    lines.push("  No assertions in this scenario — nothing was graded.");
  }
  for (const assertion of report.assertions) {
    lines.push(`  ${assertion.passed ? "PASS" : "FAIL"} ${assertion.label}`);
    lines.push(`       expected ${assertion.expected}, got ${assertion.actual}`);
    if (assertion.detail) lines.push(`       ${assertion.detail}`);
  }

  const failed = report.assertions.filter((a) => !a.passed).length;
  lines.push(
    report.passed
      ? `PASSED (${report.assertions.length} assertions)`
      : `FAILED (${failed}/${report.assertions.length} assertions, ${report.eventErrors.length} action errors)`
  );
  return lines.join("\n");
}

/**
 * CLI body. Returns the process exit code instead of calling `process.exit`, so
 * the whole thing is testable in-process.
 */
export async function main(
  argv: string[],
  out: (line: string) => void = console.log
): Promise<number> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    out(error instanceof Error ? error.message : String(error));
    return EXIT_USAGE;
  }

  let scenario: Scenario;
  try {
    const scenarioPath = resolveScenarioPath(options.file);
    scenario = scenarioSchema.parse(JSON.parse(fs.readFileSync(scenarioPath, "utf-8")));
  } catch (error) {
    out(`Could not load scenario: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }

  const geojsonPath = options.network ?? config.geojsonPath;
  if (!fs.existsSync(geojsonPath)) {
    out(`Road network not found: ${geojsonPath}`);
    return EXIT_USAGE;
  }

  let report: ScenarioRunReport;
  try {
    report = await new ScenarioRunner({
      scenario,
      geojsonPath,
      vehicles: options.vehicles,
      stepMs: options.stepMs,
      seed: options.seed,
      maxSimSeconds: options.maxSeconds,
    }).run();
  } catch (error) {
    out(`Scenario run failed: ${error instanceof Error ? error.message : String(error)}`);
    return EXIT_USAGE;
  }

  if (options.report) {
    fs.writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`);
  }
  out(options.json ? JSON.stringify(report, null, 2) : formatSummary(report));

  return report.passed ? EXIT_PASS : EXIT_ASSERTION_FAILURE;
}

/**
 * Only self-executes when run as a script, so importing this module in a test
 * doesn't run a scenario or kill the process.
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(EXIT_USAGE);
    });
}
