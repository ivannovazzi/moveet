import { describe, it, expect, beforeEach, vi } from "vitest";
import { RoadNetwork } from "../modules/RoadNetwork";
import path from "path";

describe("Route caching in RoadNetwork", () => {
  const testGeojsonPath = path.join(__dirname, "fixtures", "test-network.geojson");
  let network: RoadNetwork;

  beforeEach(() => {
    network = new RoadNetwork(testGeojsonPath);
  });

  describe("cache hit / miss", () => {
    it("should return the same route on a cache hit", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      const route1 = network.findRoute(start, end);
      const route2 = network.findRoute(start, end);

      expect(route1).not.toBeNull();
      expect(route2).not.toBeNull();

      // Shallow copy — cache returns a new object with same edges content
      expect(route2).not.toBe(route1);
      expect(route2!.distance).toBe(route1!.distance);
      expect(route2!.edges.length).toBe(route1!.edges.length);
    });

    it("should record a miss on first call and a hit on second call", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      network.findRoute(start, end);
      const statsAfterFirst = network.routeCacheStats();
      expect(statsAfterFirst.misses).toBe(1);
      expect(statsAfterFirst.hits).toBe(0);

      network.findRoute(start, end);
      const statsAfterSecond = network.routeCacheStats();
      expect(statsAfterSecond.misses).toBe(1);
      expect(statsAfterSecond.hits).toBe(1);
    });

    it("should compute different routes for different start/end pairs", () => {
      const nodeA = network.findNearestNode([45.5017, -73.5673]);
      const nodeB = network.findNearestNode([45.502, -73.567]);
      const nodeC = network.findNearestNode([45.5029, -73.5661]);

      const routeAC = network.findRoute(nodeA, nodeC);
      const routeBC = network.findRoute(nodeB, nodeC);

      expect(routeAC).not.toBeNull();
      expect(routeBC).not.toBeNull();

      // Different start nodes should produce different routes
      expect(routeAC!.edges.length).not.toBe(routeBC!.edges.length);
    });
  });

  describe("TTL expiry", () => {
    it("should recompute route after cache entry expires", () => {
      vi.useFakeTimers();
      try {
        // Use a short TTL for testing
        const shortTtlNetwork = new RoadNetwork(testGeojsonPath, { ttlMs: 500 });

        const start = shortTtlNetwork.findNearestNode([45.5017, -73.5673]);
        const end = shortTtlNetwork.findNearestNode([45.5029, -73.5661]);

        const route1 = shortTtlNetwork.findRoute(start, end);
        expect(route1).not.toBeNull();

        let stats = shortTtlNetwork.routeCacheStats();
        expect(stats.misses).toBe(1);
        expect(stats.hits).toBe(0);

        // Still cached
        shortTtlNetwork.findRoute(start, end);
        stats = shortTtlNetwork.routeCacheStats();
        expect(stats.hits).toBe(1);

        // Advance past TTL
        vi.advanceTimersByTime(501);

        // Should miss now (expired), triggering a fresh A* computation
        const route2 = shortTtlNetwork.findRoute(start, end);
        expect(route2).not.toBeNull();

        stats = shortTtlNetwork.routeCacheStats();
        expect(stats.misses).toBe(2); // original miss + expired miss
        expect(stats.hits).toBe(1);

        // Route contents should still be equivalent
        expect(route2!.edges.length).toBe(route1!.edges.length);
        expect(route2!.distance).toBeCloseTo(route1!.distance, 6);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("LRU eviction", () => {
    it("should evict oldest route when max cache size is reached", () => {
      // Create network with small cache
      const smallCacheNetwork = new RoadNetwork(testGeojsonPath, { maxSize: 2, ttlMs: 60_000 });

      const nodeA = smallCacheNetwork.findNearestNode([45.5017, -73.5673]);
      const nodeB = smallCacheNetwork.findNearestNode([45.502, -73.567]);
      const nodeC = smallCacheNetwork.findNearestNode([45.5023, -73.5667]);
      const nodeD = smallCacheNetwork.findNearestNode([45.5029, -73.5661]);

      // Fill cache with 2 routes (capacity)
      smallCacheNetwork.findRoute(nodeA, nodeB); // miss #1
      smallCacheNetwork.findRoute(nodeA, nodeC); // miss #2

      let stats = smallCacheNetwork.routeCacheStats();
      expect(stats.size).toBe(2);

      // Add a third route — evicts first (A→B)
      smallCacheNetwork.findRoute(nodeA, nodeD); // miss #3

      stats = smallCacheNetwork.routeCacheStats();
      expect(stats.size).toBe(2);

      // A→B was evicted, so requesting it again should be a miss
      smallCacheNetwork.findRoute(nodeA, nodeB); // miss #4
      stats = smallCacheNetwork.routeCacheStats();
      expect(stats.misses).toBe(4);

      // A→C was promoted implicitly when A→B was evicted (A→C is still there)
      // but A→D was the most recent, and now A→B just became most recent
      // so A→C is now the LRU
    });
  });

  describe("clearRouteCache", () => {
    it("should clear all cached routes and reset stats", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      network.findRoute(start, end); // miss
      network.findRoute(start, end); // hit

      let stats = network.routeCacheStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.size).toBe(1);

      network.clearRouteCache();

      stats = network.routeCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);

      // Requesting same route after clear should be a miss
      network.findRoute(start, end);
      stats = network.routeCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });
  });

  describe("cached route correctness", () => {
    it("should return valid route with correct edges and distance from cache", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // First call — fresh A*
      const route1 = network.findRoute(start, end);
      expect(route1).not.toBeNull();

      // Second call — from cache
      const route2 = network.findRoute(start, end);
      expect(route2).not.toBeNull();

      // Validate route structure
      expect(route2!.edges.length).toBeGreaterThan(0);
      expect(route2!.distance).toBeGreaterThan(0);

      // First edge starts at start node
      expect(route2!.edges[0].start.id).toBe(start.id);
      // Last edge ends at end node
      expect(route2!.edges[route2!.edges.length - 1].end.id).toBe(end.id);

      // Distance is sum of edge distances
      const summedDistance = route2!.edges.reduce((sum, edge) => sum + edge.distance, 0);
      expect(route2!.distance).toBeCloseTo(summedDistance, 6);
    });

    it("should not cache null routes (unreachable destinations)", () => {
      const node1 = network.getRandomNode();
      const isolated = {
        id: "isolated",
        coordinates: [90, 180] as [number, number],
        connections: [],
      };

      const route = network.findRoute(node1, isolated);
      expect(route).toBeNull();

      // Requesting the same unreachable destination should still be a miss + null
      const route2 = network.findRoute(node1, isolated);
      expect(route2).toBeNull();

      const stats = network.routeCacheStats();
      // Both calls are misses because null routes are not cached
      expect(stats.misses).toBe(2);
      expect(stats.hits).toBe(0);
      expect(stats.size).toBe(0);
    });

    it("should not corrupt routes when the same cached route is used by multiple consumers", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      const route1 = network.findRoute(start, end);
      const route2 = network.findRoute(start, end);

      // Shallow copies — different object references but same content
      expect(route1).not.toBe(route2);

      // Verify the route is still structurally valid
      expect(route1!.edges.length).toBe(route2!.edges.length);
      for (let i = 0; i < route1!.edges.length; i++) {
        expect(route1!.edges[i].id).toBe(route2!.edges[i].id);
        expect(route1!.edges[i].distance).toBe(route2!.edges[i].distance);
        expect(route1!.edges[i].start.id).toBe(route2!.edges[i].start.id);
        expect(route1!.edges[i].end.id).toBe(route2!.edges[i].end.id);
      }
    });
  });

  describe("cache stats", () => {
    it("should start with zero hits and misses", () => {
      const stats = network.routeCacheStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(500); // default
    });

    it("should accurately count hits and misses across multiple routes", () => {
      const nodeA = network.findNearestNode([45.5017, -73.5673]);
      const nodeB = network.findNearestNode([45.502, -73.567]);
      const nodeC = network.findNearestNode([45.5029, -73.5661]);

      network.findRoute(nodeA, nodeC); // miss
      network.findRoute(nodeA, nodeC); // hit
      network.findRoute(nodeB, nodeC); // miss
      network.findRoute(nodeA, nodeC); // hit
      network.findRoute(nodeB, nodeC); // hit

      const stats = network.routeCacheStats();
      expect(stats.hits).toBe(3);
      expect(stats.misses).toBe(2);
      expect(stats.size).toBe(2);
    });

    it("should reflect custom maxSize from constructor options", () => {
      const customNetwork = new RoadNetwork(testGeojsonPath, { maxSize: 42 });
      const stats = customNetwork.routeCacheStats();
      expect(stats.maxSize).toBe(42);
    });
  });

  describe("API compatibility", () => {
    it("should keep findRoute signature unchanged: (Node, Node) -> Route | null", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // Type check: result is Route | null
      const route: ReturnType<typeof network.findRoute> = network.findRoute(start, end);

      if (route) {
        expect(route.edges).toBeDefined();
        expect(route.distance).toBeDefined();
      }
    });
  });
});
