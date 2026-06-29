import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

/**
 * docker-compose black-box smoke E2E (architecture review #4).
 *
 * Brings the WHOLE stack up via docker compose, then exercises it purely
 * through its public surface (no imports of app code):
 *   1. wait for the simulator `/health` to report ok,
 *   2. POST `/start` to begin a simulation,
 *   3. poll `GET /vehicles` until vehicles appear,
 *   4. open a WebSocket and assert at least one `vehicles` frame arrives,
 *   5. assert a vehicle's position CHANGES over time (it actually moves),
 *   6. tear the stack down (always, in afterAll).
 *
 * This is a SMOKE test: it proves the images boot, wire together, and produce
 * moving vehicles end to end. It is deliberately NOT part of the unit `verify`
 * job and `npm test` does not depend on Docker — run it with `npm run test:e2e`.
 *
 * Compose file: defaults to the published GHCR images (`docker-compose.ghcr.yml`,
 * no build). Override with `MOVEET_E2E_COMPOSE_FILE` to build from source, e.g.
 *   MOVEET_E2E_COMPOSE_FILE=docker-compose.yml npm run test:e2e
 * (the source compose builds the images first — much slower).
 *
 * The simulator image needs a road network bind-mounted at
 * apps/simulator/data/network.geojson (gitignored; generate it with
 * `npx tsx apps/network/src/cli.ts prepare nairobi`). The test skips with a
 * clear message if it is missing rather than failing confusingly.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const COMPOSE_FILE = process.env.MOVEET_E2E_COMPOSE_FILE ?? "docker-compose.ghcr.yml";
const PROJECT = "moveet-e2e";
const SIM = process.env.MOVEET_E2E_SIM_URL ?? "http://localhost:5010";
const SIM_WS = process.env.MOVEET_E2E_WS_URL ?? "ws://localhost:5010";
const NETWORK_GEOJSON = path.join(REPO_ROOT, "apps", "simulator", "data", "network.geojson");

/** Run a docker compose subcommand for our isolated project. */
function compose(args: string[], opts: { quiet?: boolean } = {}): void {
  execFileSync(
    "docker",
    ["compose", "-p", PROJECT, "-f", COMPOSE_FILE, ...args],
    { cwd: REPO_ROOT, stdio: opts.quiet ? "ignore" : "inherit", timeout: 220_000 }
  );
}

/** True when a Docker daemon is reachable. */
function dockerAvailable(): boolean {
  const r = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 15_000 });
  return r.status === 0;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Poll `fn` until it resolves truthy or the deadline passes. */
async function waitFor<T>(
  label: string,
  fn: () => Promise<T | undefined | null | false>,
  { timeoutMs = 90_000, intervalMs = 2_000 } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      lastErr = err;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for: ${label}${lastErr ? ` (last error: ${lastErr})` : ""}`);
}

// Skip cleanly (rather than fail) when this environment cannot run the E2E.
const canRun = dockerAvailable() && existsSync(NETWORK_GEOJSON);
const describeMaybe = canRun ? describe : describe.skip;

if (!canRun) {
  // Surface WHY it skipped so a maintainer running it locally understands.
  // eslint-disable-next-line no-console
  console.warn(
    `[e2e] skipping docker-compose smoke test: ${
      !dockerAvailable() ? "no reachable Docker daemon" : `missing ${NETWORK_GEOJSON}`
    }`
  );
}

describeMaybe("docker-compose smoke E2E", () => {
  beforeAll(async () => {
    // Fresh stack. `down -v` first clears any leftovers from a prior run.
    compose(["down", "-v", "--remove-orphans"], { quiet: true });
    compose(["up", "-d"]);

    // 1. Simulator health.
    await waitFor("simulator /health = ok", async () => {
      const res = await fetch(`${SIM}/health`);
      if (!res.ok) return false;
      const body = (await res.json()) as { status?: string };
      return body.status === "ok";
    });
  });

  afterAll(() => {
    // Always tear down, even if the test failed.
    try {
      compose(["down", "-v", "--remove-orphans"], { quiet: true });
    } catch {
      // Best-effort: a failed teardown should not mask a test result.
    }
  });

  it("starts a simulation, serves moving vehicles, and broadcasts WS frames", async () => {
    // 2. Start the simulation (empty body — server applies defaults).
    const startRes = await fetch(`${SIM}/start`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(startRes.ok).toBe(true);

    // 3. Poll /vehicles until the fleet exists.
    type VehicleDTO = { id: string; position: [number, number] };
    const vehicles = await waitFor<VehicleDTO[]>("GET /vehicles returns a fleet", async () => {
      const res = await fetch(`${SIM}/vehicles`);
      if (!res.ok) return false;
      const body = (await res.json()) as VehicleDTO[];
      return Array.isArray(body) && body.length > 0 ? body : false;
    });
    expect(vehicles.length).toBeGreaterThan(0);
    const trackedId = vehicles[0].id;
    const initialPos = vehicles[0].position;

    // 4. + 5. Open a WS and collect `vehicles` frames; assert the tracked
    // vehicle's position changes across frames (it actually moves).
    const ws = new WebSocket(SIM_WS);
    let sawVehiclesFrame = false;
    let moved = false;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("no moving-vehicle WS frame within 60s")),
        60_000
      );

      ws.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });

      ws.on("message", (raw: WebSocket.RawData) => {
        let msg: { type?: string; data?: Array<{ id: string; position: [number, number] }> };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type !== "vehicles" || !Array.isArray(msg.data)) return;
        sawVehiclesFrame = true;
        const tracked = msg.data.find((v) => v.id === trackedId);
        if (
          tracked &&
          (tracked.position[0] !== initialPos[0] || tracked.position[1] !== initialPos[1])
        ) {
          moved = true;
          clearTimeout(timer);
          resolve();
        }
      });
    }).finally(() => ws.close());

    expect(sawVehiclesFrame).toBe(true);
    expect(moved).toBe(true);
  });
});
