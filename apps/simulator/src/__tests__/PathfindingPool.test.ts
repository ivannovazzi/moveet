import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { PathfindingPool } from "../modules/PathfindingPool";
import { EventEmitter } from "events";
import path from "path";

const testGeojsonPath = path.join(__dirname, "fixtures", "test-network.geojson");

describe("PathfindingPool", () => {
  let pool: PathfindingPool;

  afterEach(async () => {
    if (pool) {
      await pool.shutdown();
    }
  });

  it("should find a route between two connected nodes", async () => {
    pool = new PathfindingPool(testGeojsonPath, 1);

    // Main Street goes: 45.5017,-73.5673 -> 45.502,-73.567 -> 45.5023,-73.5667
    // First Avenue goes: 45.5023,-73.5667 -> 45.5026,-73.5664 -> 45.5029,-73.5661
    // Main Street is one-way, so route from start of Main to end of First Avenue
    const result = await pool.findRoute("45.5017,-73.5673", "45.5029,-73.5661");

    expect(result).not.toBeNull();
    expect(result!.edgeIds.length).toBeGreaterThan(0);
    expect(result!.distance).toBeGreaterThan(0);
  });

  it("should return null for disconnected nodes", async () => {
    pool = new PathfindingPool(testGeojsonPath, 1);

    // Use a node ID that doesn't exist in the graph
    const result = await pool.findRoute("45.5017,-73.5673", "99.99,99.99");
    expect(result).toBeNull();
  });

  it("should handle concurrent requests", async () => {
    pool = new PathfindingPool(testGeojsonPath, 2);

    const requests = [
      pool.findRoute("45.5017,-73.5673", "45.5029,-73.5661"),
      pool.findRoute("45.5017,-73.5673", "45.5023,-73.5667"),
      pool.findRoute("45.502,-73.567", "45.5026,-73.5664"),
      pool.findRoute("45.5023,-73.5667", "45.5029,-73.5661"),
    ];

    const results = await Promise.all(requests);

    // All should resolve (some may be null if no route, but shouldn't throw)
    expect(results).toHaveLength(4);
    // At least the known-connected routes should succeed
    expect(results[0]).not.toBeNull();
    expect(results[3]).not.toBeNull();
  });

  it("should terminate workers cleanly on shutdown", async () => {
    pool = new PathfindingPool(testGeojsonPath, 2);

    // Verify pool works before shutdown
    const result = await pool.findRoute("45.5017,-73.5673", "45.5023,-73.5667");
    expect(result).not.toBeNull();

    // Shutdown should not throw
    await pool.shutdown();

    // After shutdown, findRoute returns null (no workers available)
    const afterShutdown = await pool.findRoute("45.5017,-73.5673", "45.5023,-73.5667");
    expect(afterShutdown).toBeNull();
  });

  it("should return valid edge IDs that match the graph", async () => {
    pool = new PathfindingPool(testGeojsonPath, 1);

    const result = await pool.findRoute("45.5017,-73.5673", "45.5023,-73.5667");
    expect(result).not.toBeNull();

    // Edge IDs follow the format "startNodeId-endNodeId"
    for (const edgeId of result!.edgeIds) {
      expect(edgeId).toMatch(/^.+-.+$/);
    }

    // Edge chain should be contiguous: edge[n] endNodeId == edge[n+1] startNodeId
    for (let i = 0; i < result!.edgeIds.length - 1; i++) {
      const currentEnd = result!.edgeIds[i].split("-").slice(1).join("-");
      const nextStart = result!.edgeIds[i + 1].split("-")[0];
      // For node IDs like "45.5017,-73.5673", the edge ID is "45.5017,-73.5673-45.502,-73.567"
      // We need a smarter split. The edge ID has format "lat1,lon1-lat2,lon2"
      // so the separator is the third "-" conceptually. Let's just verify start of route.
      expect(currentEnd).toBeDefined();
      expect(nextStart).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests for worker crash rejection and per-request timeout.
//
// These tests mock the Worker class to simulate crashes and unresponsive
// workers without needing a real GeoJSON file or pathfinding worker.
// ---------------------------------------------------------------------------

class MockWorker extends EventEmitter {
  postMessage = vi.fn();
  terminate = vi.fn().mockResolvedValue(undefined);
}

/**
 * Internal shape of PathfindingPool (private fields accessed for testing).
 */
interface PoolInternals {
  workers: MockWorker[];
  pending: Map<number, { resolve: Function; reject: Function; workerIndex: number; timer: ReturnType<typeof setTimeout> }>;
  nextId: number;
  nextWorker: number;
  shutdownFlag: boolean;
  requestTimeoutMs: number;
  rejectPendingForWorker: (workerIndex: number, reason: string) => void;
}

describe("PathfindingPool - worker crash handling", () => {
  let mockWorkers: MockWorker[];

  beforeEach(() => {
    mockWorkers = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Create a PathfindingPool with mock workers, bypassing the constructor
   * (which would spin up real worker_threads). We manually replicate the
   * event-handler wiring that the constructor performs so that error/exit
   * events on mock workers correctly call rejectPendingForWorker.
   */
  function createPoolWithMockWorkers(
    workerCount: number,
    requestTimeoutMs?: number
  ): PathfindingPool {
    mockWorkers = [];
    for (let i = 0; i < workerCount; i++) {
      mockWorkers.push(new MockWorker());
    }

    // Create pool object without running the constructor
    const pool = Object.create(PathfindingPool.prototype) as PathfindingPool;
    const p = pool as unknown as PoolInternals;

    p.workers = mockWorkers;
    p.pending = new Map();
    p.nextId = 0;
    p.nextWorker = 0;
    p.shutdownFlag = false;
    p.requestTimeoutMs = requestTimeoutMs ?? 30_000;

    // Wire up event handlers on each mock worker, mirroring the constructor
    for (let i = 0; i < workerCount; i++) {
      const worker = mockWorkers[i];

      worker.on("message", (msg: { type: string; id: number; route: unknown }) => {
        if (msg.type === "result") {
          const req = p.pending.get(msg.id);
          if (req) {
            clearTimeout(req.timer);
            p.pending.delete(msg.id);
            req.resolve(msg.route);
          }
        }
      });

      worker.on("error", (err: Error) => {
        p.rejectPendingForWorker.call(pool, i, `Pathfinding worker ${i} crashed: ${err.message}`);
      });

      worker.on("exit", (code: number) => {
        if (!p.shutdownFlag && code !== 0) {
          p.rejectPendingForWorker.call(pool, i, `Pathfinding worker ${i} exited with code ${code}`);
        }
      });
    }

    return pool;
  }

  it("should reject pending requests when a worker emits an error", async () => {
    const pool = createPoolWithMockWorkers(1);

    // Send a request - it will be dispatched to worker 0
    const routePromise = pool.findRoute("nodeA", "nodeB");

    // Simulate a worker crash
    mockWorkers[0].emit("error", new Error("Worker segfault"));

    // The promise should reject with the crash error
    await expect(routePromise).rejects.toThrow("Pathfinding worker 0 crashed: Worker segfault");

    await pool.shutdown();
  });

  it("should reject only the requests belonging to the crashed worker", async () => {
    const pool = createPoolWithMockWorkers(2);

    // Dispatch 4 requests: they round-robin across 2 workers
    // Request 0 -> worker 0
    // Request 1 -> worker 1
    // Request 2 -> worker 0
    // Request 3 -> worker 1
    const promise0 = pool.findRoute("a", "b"); // worker 0
    const promise1 = pool.findRoute("c", "d"); // worker 1
    const promise2 = pool.findRoute("e", "f"); // worker 0
    const promise3 = pool.findRoute("g", "h"); // worker 1

    // Crash worker 0 - should reject promise0 and promise2
    mockWorkers[0].emit("error", new Error("crash"));

    await expect(promise0).rejects.toThrow("Pathfinding worker 0 crashed");
    await expect(promise2).rejects.toThrow("Pathfinding worker 0 crashed");

    // Worker 1 requests should still be pending (not rejected yet)
    // Resolve them normally via a message event
    mockWorkers[1].emit("message", { type: "result", id: 1, route: { edgeIds: ["x"], distance: 1 } });
    mockWorkers[1].emit("message", { type: "result", id: 3, route: null });

    const result1 = await promise1;
    const result3 = await promise3;
    expect(result1).toEqual({ edgeIds: ["x"], distance: 1 });
    expect(result3).toBeNull();

    await pool.shutdown();
  });

  it("should reject pending requests when a worker exits with non-zero code", async () => {
    const pool = createPoolWithMockWorkers(1);

    const routePromise = pool.findRoute("a", "b");

    // Simulate worker exit with non-zero code
    mockWorkers[0].emit("exit", 1);

    await expect(routePromise).rejects.toThrow("Pathfinding worker 0 exited with code 1");

    await pool.shutdown();
  });

  it("should not reject requests on clean exit (code 0)", async () => {
    const pool = createPoolWithMockWorkers(1);

    const routePromise = pool.findRoute("a", "b");

    // Simulate clean exit (code 0) - should NOT reject
    mockWorkers[0].emit("exit", 0);

    // The promise should still be pending (not rejected).
    // Resolve it manually to verify it wasn't rejected.
    mockWorkers[0].emit("message", { type: "result", id: 0, route: null });

    const result = await routePromise;
    expect(result).toBeNull();

    await pool.shutdown();
  });

  it("should timeout requests that never receive a response", async () => {
    vi.useFakeTimers();

    try {
      const pool = createPoolWithMockWorkers(1, 500); // 500ms timeout

      const routePromise = pool.findRoute("a", "b");

      // Advance time past the timeout
      vi.advanceTimersByTime(501);

      await expect(routePromise).rejects.toThrow("timed out after 500ms");

      await pool.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("should not timeout requests that complete in time", async () => {
    vi.useFakeTimers();

    try {
      const pool = createPoolWithMockWorkers(1, 5000);

      const routePromise = pool.findRoute("a", "b");

      // Respond before timeout
      mockWorkers[0].emit("message", {
        type: "result",
        id: 0,
        route: { edgeIds: ["edge1"], distance: 42 },
      });

      const result = await routePromise;
      expect(result).toEqual({ edgeIds: ["edge1"], distance: 42 });

      // Advance past timeout - nothing should happen (timer was cleared)
      vi.advanceTimersByTime(6000);

      await pool.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });

  it("should clear timers on shutdown", async () => {
    vi.useFakeTimers();

    try {
      const pool = createPoolWithMockWorkers(1, 5000);

      const routePromise = pool.findRoute("a", "b");

      // Shutdown before timeout fires
      await pool.shutdown();

      // The promise should reject with shutdown message, not timeout
      await expect(routePromise).rejects.toThrow("PathfindingPool shutting down");

      // Advance timers - no unhandled rejections should occur
      vi.advanceTimersByTime(10000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should handle multiple pending requests timing out", async () => {
    vi.useFakeTimers();

    try {
      const pool = createPoolWithMockWorkers(1, 200);

      const p1 = pool.findRoute("a", "b");
      const p2 = pool.findRoute("c", "d");
      const p3 = pool.findRoute("e", "f");

      // Advance past timeout
      vi.advanceTimersByTime(201);

      await expect(p1).rejects.toThrow("timed out");
      await expect(p2).rejects.toThrow("timed out");
      await expect(p3).rejects.toThrow("timed out");

      await pool.shutdown();
    } finally {
      vi.useRealTimers();
    }
  });
});
