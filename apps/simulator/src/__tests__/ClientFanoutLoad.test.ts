import { describe, it, expect, afterEach } from "vitest";
import type { WebSocket, WebSocketServer } from "ws";
import { ClientFanout } from "../modules/ws/ClientFanout";
import type { VehicleDTO } from "../types";

/**
 * Load test for the WS fan-out hot path (fleetsim-all-7ksg, 2026-07-01
 * perf/quality audit).
 *
 * `ClientFanout.fanoutVehicles` is O(clients x vehicles) per flush - it runs
 * once per broadcaster flush (10Hz by default) against every connected
 * client. This test exercises that method directly at increasing synthetic
 * client counts (mocked WebSocket objects, same boundary
 * WebSocketBroadcaster.test.ts mocks at) and measures per-flush wall-clock
 * time, WITHOUT real sockets or an external Redis.
 *
 * This is a DETERMINISTIC scaling measurement, not a strict pass/fail perf
 * budget guard like PerfBudget.test.ts - there is no "correct" absolute
 * number since it depends on the machine running it. Instead it:
 *   1. Asserts the cost scales roughly linearly with client count (catches a
 *      gross algorithmic regression, e.g. an accidental O(n^2) in clients).
 *   2. Prints a client-count -> per-flush-time table to stdout so the
 *      numbers can be captured in the PR description / docs as a rough
 *      guide for when to switch WS_TRANSPORT=redis.
 *
 * Vehicle count is fixed at 70 (the documented in-process baseline - see
 * CLAUDE.md "WebSocket fan-out transport") so the only scaling variable is
 * client count.
 */

const VEHICLE_COUNT = 70;
const CLIENT_COUNTS = [10, 50, 100, 200, 500];
// Each client gets a distinct lastSent state, so every flush is a real
// "vehicle changed" pass rather than a cache hit that skips work.
const FLUSHES_PER_SCALE = 20;

function makeMockClient(): WebSocket {
  return {
    readyState: 1, // OPEN
    bufferedAmount: 0,
    send: () => {},
    on: () => {},
  } as unknown as WebSocket;
}

function makeMockWss(clients: WebSocket[]): WebSocketServer {
  return { clients: new Set(clients) } as unknown as WebSocketServer;
}

function makeVehicles(count: number, tick: number): VehicleDTO[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `v${i}`,
    name: `Vehicle ${i}`,
    type: "car",
    // Perturb position every tick so delta filtering never skips the send -
    // we want to measure the real per-flush work, not a cache short-circuit.
    position: [-1.286 + tick * 0.0001, 36.817 + i * 0.0001] as [number, number],
    speed: 40,
    heading: 90,
  }));
}

interface ScaleResult {
  clientCount: number;
  totalMs: number;
  perFlushMs: number;
}

describe("ClientFanout load test (fleetsim-all-7ksg)", () => {
  const fanouts: ClientFanout[] = [];
  const results: ScaleResult[] = [];

  afterEach(() => {
    for (const f of fanouts.splice(0)) f.stop();
  });

  it.each(
    CLIENT_COUNTS
  )("measures fanoutVehicles wall-clock time with %i clients @ 70 vehicles", (clientCount) => {
    const clients = Array.from({ length: clientCount }, () => makeMockClient());
    const wss = makeMockWss(clients);
    const fanout = new ClientFanout(wss, {
      pingIntervalMs: 0,
      pongTimeoutMs: 0,
    });
    fanouts.push(fanout);

    // Warm up (JIT + first-send-always-included path) before measuring.
    fanout.fanoutVehicles(makeVehicles(VEHICLE_COUNT, 0));

    const start = performance.now();
    for (let tick = 1; tick <= FLUSHES_PER_SCALE; tick++) {
      fanout.fanoutVehicles(makeVehicles(VEHICLE_COUNT, tick));
    }
    const totalMs = performance.now() - start;
    const perFlushMs = totalMs / FLUSHES_PER_SCALE;

    results.push({ clientCount, totalMs, perFlushMs });

    // Not a strict budget assertion (this is a scaling measurement, not a
    // regression guard) - just a loose sanity ceiling so a genuine hang or
    // infinite loop still fails the test instead of timing out silently.
    expect(perFlushMs).toBeLessThan(2000);
  });

  it("prints the client-count -> per-flush-time scaling table", () => {
    // This runs after the it.each block (vitest preserves declaration order),
    // so `results` is fully populated. Guard in case it ever runs standalone.
    if (results.length < CLIENT_COUNTS.length) return;

    const rows = results
      .slice()
      .sort((a, b) => a.clientCount - b.clientCount)
      .map((r) => `| ${r.clientCount} | ${r.perFlushMs.toFixed(3)} ms |`);

    console.log(
      [
        "\nClientFanout load test results (70 vehicles, mocked WS clients):",
        "| Clients | Per-flush time |",
        "| --- | --- |",
        ...rows,
        "",
      ].join("\n")
    );

    // Sanity: cost should not blow up worse than roughly quadratic between
    // the smallest and largest scale (catches a gross O(n^2)-in-clients
    // regression; fanoutVehicles is expected O(clients x vehicles), i.e.
    // linear in clients for fixed vehicle count).
    const smallest = results.reduce((a, b) => (a.clientCount < b.clientCount ? a : b));
    const largest = results.reduce((a, b) => (a.clientCount > b.clientCount ? a : b));
    const clientRatio = largest.clientCount / smallest.clientCount;
    // Guard against div-by-zero on an unrealistically fast smallest-scale run.
    const timeRatio = largest.perFlushMs / Math.max(smallest.perFlushMs, 0.001);

    expect(timeRatio).toBeLessThan(clientRatio * clientRatio);
  });
});
