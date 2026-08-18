import { describe, it, expect, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  EXIT_ASSERTION_FAILURE,
  EXIT_PASS,
  EXIT_USAGE,
  main,
  parseArgs,
  resolveScenarioPath,
} from "../headless/scenario-cli";
import type { ScenarioRunReport } from "../headless/ScenarioRunner";

const FIXTURE_PATH = path.join(__dirname, "fixtures", "integration-network.geojson");

const tmpFiles: string[] = [];

function tmpFile(contents: string, extension = ".json"): string {
  const file = path.join(os.tmpdir(), `scenario-cli-${process.pid}-${tmpFiles.length}${extension}`);
  fs.writeFileSync(file, contents);
  tmpFiles.push(file);
  return file;
}

function tmpPath(extension = ".json"): string {
  const file = path.join(
    os.tmpdir(),
    `scenario-cli-out-${process.pid}-${tmpFiles.length}${extension}`
  );
  tmpFiles.push(file);
  return file;
}

/** Collects the CLI's output so a test can assert on what an operator sees. */
function capture() {
  const lines: string[] = [];
  return { lines, out: (line: string) => lines.push(line) };
}

const scenarioJson = (assertions: unknown[], duration = 10) =>
  JSON.stringify({
    name: "cli-test",
    duration,
    events: [],
    assertions,
  });

afterEach(() => {
  for (const file of tmpFiles.splice(0)) {
    try {
      fs.rmSync(file);
    } catch {
      // never created / already gone
    }
  }
});

describe("parseArgs", () => {
  it("parses every option", () => {
    const opts = parseArgs([
      "my-scenario.json",
      "--vehicles",
      "12",
      "--step-ms",
      "500",
      "--seed",
      "9",
      "--max-seconds",
      "60",
      "--network",
      "net.geojson",
      "--report",
      "report.json",
      "--json",
    ]);

    expect(opts).toEqual({
      file: "my-scenario.json",
      vehicles: 12,
      stepMs: 500,
      seed: 9,
      maxSeconds: 60,
      network: "net.geojson",
      report: "report.json",
      json: true,
    });
  });

  it("defaults json off and leaves unset options undefined", () => {
    expect(parseArgs(["scenario.json"])).toEqual({ file: "scenario.json", json: false });
  });

  it("rejects unusable invocations", () => {
    expect(() => parseArgs([])).toThrow("Usage");
    expect(() => parseArgs(["--help"])).toThrow("Usage");
    expect(() => parseArgs(["a.json", "b.json"])).toThrow("Expected one scenario file");
    expect(() => parseArgs(["a.json", "--nope"])).toThrow("Unknown option: --nope");
    expect(() => parseArgs(["a.json", "--seed", "abc"])).toThrow("--seed requires a number");
    expect(() => parseArgs(["a.json", "--seed"])).toThrow("--seed requires a number");
    expect(() => parseArgs(["a.json", "--network"])).toThrow("--network requires a value");
  });
});

describe("resolveScenarioPath", () => {
  it("resolves an explicit path", () => {
    const file = tmpFile(scenarioJson([]));
    expect(resolveScenarioPath(file)).toBe(path.resolve(file));
  });

  it("resolves a bare name against data/scenarios, with or without the extension", () => {
    // Shipped with the repo; both spellings must land on the same file.
    expect(resolveScenarioPath("dispatch-regression")).toBe(
      resolveScenarioPath("dispatch-regression.json")
    );
  });

  it("throws when nothing matches", () => {
    expect(() => resolveScenarioPath("no-such-scenario")).toThrow("Scenario not found");
  });
});

describe("scenario CLI", () => {
  it("exits 0 and prints a summary when the assertions hold", async () => {
    const file = tmpFile(scenarioJson([{ type: "no_stranded_vehicles", idleSeconds: 120 }]));
    const { lines, out } = capture();

    const code = await main([file, "--network", FIXTURE_PATH, "--vehicles", "1"], out);

    expect(code).toBe(EXIT_PASS);
    const text = lines.join("\n");
    expect(text).toContain("Scenario: cli-test");
    expect(text).toContain("PASS no vehicle idle for more than 120s");
    expect(text).toContain("PASSED (1 assertions)");
  });

  it("exits 1 and reports the failing assertion", async () => {
    const file = tmpFile(scenarioJson([{ type: "fleet_avg_speed", atLeastKph: 500 }]));
    const { lines, out } = capture();

    const code = await main([file, "--network", FIXTURE_PATH, "--vehicles", "1"], out);

    expect(code).toBe(EXIT_ASSERTION_FAILURE);
    const text = lines.join("\n");
    expect(text).toContain("FAIL fleet average speed >= 500 km/h");
    expect(text).toContain("FAILED (1/1 assertions");
  });

  it("writes the JSON report to a file and to stdout when asked", async () => {
    const file = tmpFile(scenarioJson([]));
    const reportPath = tmpPath();
    const { lines, out } = capture();

    const code = await main(
      [file, "--network", FIXTURE_PATH, "--vehicles", "1", "--json", "--report", reportPath],
      out
    );

    expect(code).toBe(EXIT_PASS);
    const onDisk = JSON.parse(fs.readFileSync(reportPath, "utf-8")) as ScenarioRunReport;
    expect(onDisk.scenario.name).toBe("cli-test");
    expect(onDisk.passed).toBe(true);
    // --json means the printed output IS the report.
    expect(JSON.parse(lines.join("\n")).scenario.name).toBe("cli-test");
  });

  it("says so when a scenario has no assertions", async () => {
    const file = tmpFile(scenarioJson([]));
    const { lines, out } = capture();

    await main([file, "--network", FIXTURE_PATH, "--vehicles", "1"], out);
    expect(lines.join("\n")).toContain("No assertions in this scenario");
  });

  it("exits 2 on a bad invocation, a missing scenario, an invalid one, or a missing network", async () => {
    const { lines, out } = capture();

    expect(await main([], out)).toBe(EXIT_USAGE);
    expect(lines.join("\n")).toContain("Usage");

    expect(await main(["definitely-not-a-scenario"], out)).toBe(EXIT_USAGE);

    const notJson = tmpFile("{ not json");
    expect(await main([notJson], out)).toBe(EXIT_USAGE);

    const wrongShape = tmpFile(JSON.stringify({ name: "no-duration", events: [] }));
    expect(await main([wrongShape], out)).toBe(EXIT_USAGE);

    const valid = tmpFile(scenarioJson([]));
    expect(await main([valid, "--network", "/nope/network.geojson"], out)).toBe(EXIT_USAGE);
    expect(lines.join("\n")).toContain("Road network not found");
  });

  it("exits 2 when the run itself cannot start", async () => {
    const file = tmpFile(scenarioJson([]));
    const { lines, out } = capture();

    const code = await main([file, "--network", FIXTURE_PATH, "--step-ms", "0"], out);

    expect(code).toBe(EXIT_USAGE);
    expect(lines.join("\n")).toContain("Scenario run failed");
  });
});
