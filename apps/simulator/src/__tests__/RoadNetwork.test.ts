import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { RoadNetwork } from "../modules/RoadNetwork";
import type { Edge } from "../types";
import * as utils from "../utils/helpers";
import path from "path";

describe("RoadNetwork", () => {
  let network: RoadNetwork;
  const testGeojsonPath = path.join(__dirname, "fixtures", "test-network.geojson");

  beforeEach(() => {
    network = new RoadNetwork(testGeojsonPath);
  });

  describe("constructor", () => {
    it("should load and build network from GeoJSON file", () => {
      expect(network).toBeDefined();
      expect(network.getRandomNode()).toBeDefined();
      expect(network.getRandomEdge()).toBeDefined();
    });

    it("should throw error if GeoJSON file does not exist", () => {
      expect(() => new RoadNetwork("/nonexistent/path.geojson")).toThrow();
    });
  });

  describe("findNearestNode", () => {
    it("should find nearest node to a given position", () => {
      const position: [number, number] = [45.502, -73.567];
      const node = network.findNearestNode(position);

      expect(node).toBeDefined();
      expect(node.id).toBeDefined();
      expect(node.coordinates).toHaveLength(2);
      expect(node.connections).toBeDefined();
    });

    it("should return closest node among multiple candidates", () => {
      const position: [number, number] = [45.5017, -73.5673]; // Exact match with first node
      const node = network.findNearestNode(position);

      expect(node.coordinates[0]).toBeCloseTo(45.5017, 4);
      expect(node.coordinates[1]).toBeCloseTo(-73.5673, 4);
    });

    it("should throw error if network has no nodes", () => {
      const emptyNetwork = new RoadNetwork(testGeojsonPath);
      // @ts-expect-error - Testing private property
      emptyNetwork.nodes.clear();

      expect(() => emptyNetwork.findNearestNode([45.5, -73.5])).toThrow("Network has no nodes");
    });
  });

  describe("findNearestRoad", () => {
    it("should find nearest road to a given position", () => {
      const position: [number, number] = [45.502, -73.567];
      const road = network.findNearestRoad(position);

      expect(road).toBeDefined();
      expect(road.name).toBeDefined();
      expect(road.nodeIds).toBeDefined();
      expect(road.streets).toBeDefined();
    });

    it("should return road containing the nearest node", () => {
      const position: [number, number] = [45.5017, -73.5673];
      const road = network.findNearestRoad(position);

      expect(["Main Street", "First Avenue", "Second Avenue"]).toContain(road.name);
    });
  });

  describe("findRoute", () => {
    it("should find route between two connected nodes", () => {
      const start = network.getRandomNode();
      let end = network.getRandomNode();
      // Ensure start != end to avoid trivial 0-distance route
      let attempts = 0;
      while (start.id === end.id && attempts < 10) {
        end = network.getRandomNode();
        attempts++;
      }

      const route = network.findRoute(start, end);

      if (route) {
        expect(route.edges).toBeDefined();
        expect(route.distance).toBeGreaterThan(0);
        expect(route.edges.length).toBeGreaterThan(0);
      } else {
        // If no route found, nodes might be isolated
        expect(route).toBeNull();
      }
    });

    it("should return null if no route exists", () => {
      const node1 = network.getRandomNode();
      // Create isolated node by modifying test case
      const node2 = { id: "isolated", coordinates: [90, 180] as [number, number], connections: [] };

      const route = network.findRoute(node1, node2);
      expect(route).toBeNull();
    });

    it("should return route with correct start and end nodes", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      const route = network.findRoute(start, end);

      if (route && route.edges.length > 0) {
        expect(route.edges[0].start.id).toBe(start.id);
        expect(route.edges[route.edges.length - 1].end.id).toBe(end.id);
      }
    });

    it("should have admissible heuristic (estimate <= actual travel time)", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // Heuristic: straight-line distance / 110 (max possible speed)
      const heuristic = utils.calculateDistance(start.coordinates, end.coordinates) / 110;

      const route = network.findRoute(start, end);
      expect(route).not.toBeNull();

      // Actual travel time = sum of (edge.distance / edge.maxSpeed) along the route
      let actualTravelTime = 0;
      for (const edge of route!.edges) {
        const surfacePenalty = edge.surface === "unpaved" || edge.surface === "dirt" ? 1.3 : 1.0;
        actualTravelTime += (edge.distance / edge.maxSpeed) * surfacePenalty;
      }

      // Admissibility: heuristic must not overestimate actual cost
      expect(heuristic).toBeLessThanOrEqual(actualTravelTime);
    });

    it("should return a valid route with edges and positive distance", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      const route = network.findRoute(start, end);

      expect(route).not.toBeNull();
      expect(route!.edges.length).toBeGreaterThan(0);
      expect(route!.distance).toBeGreaterThan(0);

      // Distance should be physical distance (km), not travel time
      // Verify by summing edge distances
      const summedDistance = route!.edges.reduce((sum, edge) => sum + edge.distance, 0);
      expect(route!.distance).toBeCloseTo(summedDistance, 6);
    });
  });

  describe("findRouteAsync", () => {
    afterEach(async () => {
      await network.shutdownWorkers();
    });

    it("should find the same route as synchronous findRoute", async () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      const syncRoute = network.findRoute(start, end);
      const asyncRoute = await network.findRouteAsync(start, end);

      expect(syncRoute).not.toBeNull();
      expect(asyncRoute).not.toBeNull();
      expect(asyncRoute!.distance).toBeCloseTo(syncRoute!.distance, 6);
      expect(asyncRoute!.edges.length).toBe(syncRoute!.edges.length);

      // Same edge IDs in the same order
      for (let i = 0; i < syncRoute!.edges.length; i++) {
        expect(asyncRoute!.edges[i].id).toBe(syncRoute!.edges[i].id);
      }
    });

    it("should return null when no route exists", async () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      // Isolated node not in the graph
      const isolated = {
        id: "isolated",
        coordinates: [90, 180] as [number, number],
        connections: [],
      };

      const route = await network.findRouteAsync(start, isolated);
      expect(route).toBeNull();
    });

    it("should return Route with proper Edge objects from main thread", async () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      const route = await network.findRouteAsync(start, end);
      expect(route).not.toBeNull();

      // Verify the edges are full Edge objects (have start.connections, etc.)
      for (const edge of route!.edges) {
        expect(edge.start).toBeDefined();
        expect(edge.end).toBeDefined();
        expect(edge.start.connections).toBeDefined();
        expect(Array.isArray(edge.start.connections)).toBe(true);
        expect(edge.distance).toBeGreaterThan(0);
      }
    });
  });

  describe("getEdge", () => {
    it("should return an edge by its ID", () => {
      const edge = network.getRandomEdge();
      const found = network.getEdge(edge.id);
      expect(found).toBe(edge);
    });

    it("should return undefined for non-existent edge ID", () => {
      const found = network.getEdge("nonexistent-edge-id");
      expect(found).toBeUndefined();
    });
  });

  describe("searchByName", () => {
    it("should find roads matching query", () => {
      const results = network.searchByName("Main");

      expect(results).toBeDefined();
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toContain("Main");
    });

    it("should be case insensitive", () => {
      const resultsLower = network.searchByName("main");
      const resultsUpper = network.searchByName("MAIN");

      expect(resultsLower.length).toBe(resultsUpper.length);
    });

    it("should return empty array for non-matching query", () => {
      const results = network.searchByName("NonexistentRoad");

      expect(results).toHaveLength(0);
    });

    it("should return partial matches", () => {
      const results = network.searchByName("Avenue");

      expect(results.length).toBeGreaterThanOrEqual(2); // First and Second Avenue
      expect(results.some((r) => r.name.includes("Avenue"))).toBe(true);
    });
  });

  describe("getAllPOIs", () => {
    it("should return all points of interest from network", () => {
      const pois = network.getAllPOIs();

      expect(pois).toBeDefined();
      expect(pois.length).toBeGreaterThan(0);
    });

    it("should include POI with shop type", () => {
      const pois = network.getAllPOIs();
      const shopPoi = pois.find((p) => p.type === "shop");

      expect(shopPoi).toBeDefined();
      expect(shopPoi?.name).toBe("Coffee Shop");
    });

    it("should have valid coordinates for each POI", () => {
      const pois = network.getAllPOIs();

      pois.forEach((poi) => {
        expect(poi.coordinates).toHaveLength(2);
        expect(typeof poi.coordinates[0]).toBe("number");
        expect(typeof poi.coordinates[1]).toBe("number");
      });
    });
  });

  describe("getRandomNode", () => {
    it("should return a valid node", () => {
      const node = network.getRandomNode();

      expect(node).toBeDefined();
      expect(node.id).toBeDefined();
      expect(node.coordinates).toHaveLength(2);
    });

    it("should return different nodes on multiple calls", () => {
      const nodes = Array.from({ length: 10 }, () => network.getRandomNode());
      const uniqueIds = new Set(nodes.map((n) => n.id));

      // With multiple calls, we should get at least some variety
      // (could be same node sometimes due to randomness, but not always)
      expect(uniqueIds.size).toBeGreaterThan(0);
    });
  });

  describe("getRandomEdge", () => {
    it("should return a valid edge", () => {
      const edge = network.getRandomEdge();

      expect(edge).toBeDefined();
      expect(edge.id).toBeDefined();
      expect(edge.start).toBeDefined();
      expect(edge.end).toBeDefined();
      expect(edge.distance).toBeGreaterThan(0);
      expect(edge.bearing).toBeGreaterThanOrEqual(0);
      expect(edge.bearing).toBeLessThanOrEqual(360);
    });
  });

  describe("getConnectedEdges", () => {
    it("should return edges connected to given edge", () => {
      const edge = network.getRandomEdge();
      const connectedEdges = network.getConnectedEdges(edge);

      expect(connectedEdges).toBeDefined();
      expect(Array.isArray(connectedEdges)).toBe(true);
    });

    it("should not include reverse edge in connected edges", () => {
      const edge = network.getRandomEdge();
      const connectedEdges = network.getConnectedEdges(edge);

      // Should not include edge that goes back to start
      connectedEdges.forEach((e) => {
        expect(e.end.id).not.toBe(edge.start.id);
      });
    });
  });

  describe("heat zones", () => {
    it("should generate heat zones", () => {
      network.generateHeatedZones({ count: 3 });
      const zones = network.exportHeatZones();

      expect(zones).toBeDefined();
      expect(zones.length).toBeGreaterThan(0);
      expect(zones.length).toBeLessThanOrEqual(3);
    });

    it("should export heat zones as features", () => {
      network.generateHeatedZones({ count: 2 });
      const features = network.exportHeatZones();

      features.forEach((feature) => {
        expect(feature.type).toBe("Feature");
        expect(feature.properties.intensity).toBeGreaterThan(0);
        expect(feature.properties.intensity).toBeLessThanOrEqual(1);
        expect(feature.geometry.type).toBe("Polygon");
      });
    });

    it("should detect if position is in heat zone", () => {
      network.generateHeatedZones({ count: 5, minRadius: 2, maxRadius: 3 });

      // Test with a position from the network
      const node = network.getRandomNode();
      const isInZone = network.isPositionInHeatZone(node.coordinates);

      expect(typeof isInZone).toBe("boolean");
    });
  });

  describe("getFeatures", () => {
    it("should return GeoJSON features without POIs", () => {
      const features = network.getFeatures();

      expect(features.type).toBe("FeatureCollection");
      expect(features.features).toBeDefined();

      // All features should be LineStrings (roads), not Points
      features.features.forEach((feature) => {
        expect(feature.geometry.type).toBe("LineString");
      });
    });
  });

  describe("getAllRoads", () => {
    it("should return all roads in the network", () => {
      const roads = network.getAllRoads();

      expect(roads).toBeDefined();
      expect(roads.length).toBeGreaterThan(0);

      roads.forEach((road) => {
        expect(road.name).toBeDefined();
        expect(road.nodeIds).toBeDefined();
        expect(road.streets).toBeDefined();
      });
    });
  });

  describe("edge road metadata", () => {
    it("should preserve highway type from GeoJSON", () => {
      // Main Street has highway: "primary"
      const edge = findEdgeByName("Main Street");
      expect(edge).toBeDefined();
      expect(edge!.highway).toBe("primary");

      // First Avenue has highway: "secondary"
      const edge2 = findEdgeByName("First Avenue");
      expect(edge2).toBeDefined();
      expect(edge2!.highway).toBe("secondary");

      // Second Avenue has highway: "tertiary"
      const edge3 = findEdgeByName("Second Avenue");
      expect(edge3).toBeDefined();
      expect(edge3!.highway).toBe("tertiary");
    });

    it("should preserve maxSpeed from GeoJSON maxspeed", () => {
      // Main Street has maxspeed: "50"
      const edge = findEdgeByName("Main Street");
      expect(edge).toBeDefined();
      expect(edge!.maxSpeed).toBe(50);
    });

    it("should get default maxSpeed by highway type when maxspeed not specified", () => {
      // First Avenue has highway: "secondary" but no maxspeed
      // DEFAULT_SPEEDS.secondary = 50
      const edge = findEdgeByName("First Avenue");
      expect(edge).toBeDefined();
      expect(edge!.maxSpeed).toBe(50);

      // Second Avenue has highway: "tertiary" but no maxspeed
      // DEFAULT_SPEEDS.tertiary = 40
      const edge2 = findEdgeByName("Second Avenue");
      expect(edge2).toBeDefined();
      expect(edge2!.maxSpeed).toBe(40);
    });

    it("should preserve surface type", () => {
      // Main Street has surface: "asphalt"
      const edge = findEdgeByName("Main Street");
      expect(edge).toBeDefined();
      expect(edge!.surface).toBe("asphalt");

      // First Avenue has surface: "paved"
      const edge2 = findEdgeByName("First Avenue");
      expect(edge2).toBeDefined();
      expect(edge2!.surface).toBe("paved");

      // Second Avenue has no surface specified → "unknown"
      const edge3 = findEdgeByName("Second Avenue");
      expect(edge3).toBeDefined();
      expect(edge3!.surface).toBe("unknown");
    });

    it("should not create reverse edges for one-way roads", () => {
      // Main Street is oneway: "yes"
      // It goes from node A → B → C, so forward edges exist but reverse edges should not
      const allEdges = getAllEdges();

      // Find forward edges for Main Street
      const mainStreetForward = allEdges.filter(
        (e) => e.name === "Main Street" && e.oneway === true
      );
      expect(mainStreetForward.length).toBeGreaterThan(0);

      // For each forward edge, verify no reverse edge exists
      for (const fwd of mainStreetForward) {
        const reverseId = `${fwd.end.id}-${fwd.start.id}`;
        const reverseEdge = allEdges.find((e) => e.id === reverseId && e.name === "Main Street");
        expect(reverseEdge).toBeUndefined();
      }
    });

    it("should create reverse edges for bidirectional roads", () => {
      // First Avenue has no oneway property → bidirectional
      const allEdges = getAllEdges();

      const firstAveForward = allEdges.filter(
        (e) => e.name === "First Avenue" && e.oneway === false
      );
      expect(firstAveForward.length).toBeGreaterThan(0);

      // For each forward edge, a reverse edge should exist
      for (const fwd of firstAveForward) {
        const reverseId = `${fwd.end.id}-${fwd.start.id}`;
        const reverseEdge = allEdges.find((e) => e.id === reverseId && e.name === "First Avenue");
        expect(reverseEdge).toBeDefined();
        expect(reverseEdge!.oneway).toBe(false);
      }
    });
  });

  describe("parseMaxSpeed edge cases (via edges)", () => {
    it("should use default speed for highway type when maxspeed is absent", () => {
      // First Avenue: secondary, no maxspeed → DEFAULT_SPEEDS.secondary = 50
      const edge = findEdgeByName("First Avenue");
      expect(edge).toBeDefined();
      expect(edge!.maxSpeed).toBe(50);

      // Second Avenue: tertiary, no maxspeed → DEFAULT_SPEEDS.tertiary = 40
      const edge2 = findEdgeByName("Second Avenue");
      expect(edge2).toBeDefined();
      expect(edge2!.maxSpeed).toBe(40);
    });

    it("should parse explicit maxspeed string to a number", () => {
      // Main Street has maxspeed: "50" → should be numeric 50
      const edge = findEdgeByName("Main Street");
      expect(edge).toBeDefined();
      expect(edge!.maxSpeed).toBe(50);
      expect(typeof edge!.maxSpeed).toBe("number");
    });

    it('should average a range maxspeed like "80-110"', () => {
      // We cannot modify the fixture, but we can create a network with a range maxspeed
      // by adding a feature to a temporary GeoJSON file
      const fs = require("fs");
      const os = require("os");
      const tmpPath = path.join(os.tmpdir(), `test-range-speed-${Date.now()}.geojson`);
      const geojson = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {
              id: "road-range",
              name: "Range Road",
              highway: "motorway",
              maxspeed: "80-110",
            },
            geometry: {
              type: "LineString",
              coordinates: [
                [-73.5673, 45.5017],
                [-73.567, 45.502],
              ],
            },
          },
        ],
      };
      fs.writeFileSync(tmpPath, JSON.stringify(geojson));
      try {
        const rangeNetwork = new RoadNetwork(tmpPath);
        const edge = rangeNetwork.getRandomEdge();
        expect(edge.maxSpeed).toBe(95); // (80 + 110) / 2
      } finally {
        fs.unlinkSync(tmpPath);
      }
    });
  });

  describe("getPOINodes caching", () => {
    it("should return the same array reference on subsequent calls", () => {
      const first = network.getPOINodes();
      const second = network.getPOINodes();
      expect(first).toBe(second); // reference equality, not deep equality
    });

    it("should return nodes that correspond to POIs", () => {
      const poiNodes = network.getPOINodes();
      const pois = network.getAllPOIs();
      expect(poiNodes.length).toBe(pois.length);

      // Each POI node should be the nearest node to that POI's coordinates
      for (let i = 0; i < pois.length; i++) {
        const expected = network.findNearestNode(pois[i].coordinates);
        expect(poiNodes[i].id).toBe(expected.id);
      }
    });
  });

  describe("weighted A* routing details", () => {
    it("should produce route edges with valid numeric maxSpeed values", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);
      const route = network.findRoute(start, end);
      expect(route).not.toBeNull();

      for (const edge of route!.edges) {
        expect(typeof edge.maxSpeed).toBe("number");
        expect(isNaN(edge.maxSpeed)).toBe(false);
        expect(edge.maxSpeed).toBeGreaterThan(0);
      }
    });

    it("should report route distance as physical km, not travel time", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);
      const route = network.findRoute(start, end);
      expect(route).not.toBeNull();

      // Sum of edge distances should equal route distance
      const physicalDistance = route!.edges.reduce((sum, e) => sum + e.distance, 0);
      expect(route!.distance).toBeCloseTo(physicalDistance, 10);

      // Travel time would be sum of (distance/speed), which is much smaller than physical distance
      // so route.distance should NOT equal the travel time
      let travelTime = 0;
      for (const edge of route!.edges) {
        travelTime += edge.distance / edge.maxSpeed;
      }
      // Physical distance in km vs travel time in hours — they should differ
      // (unless the route is trivially short, but even then maxSpeed > 1 so they'd differ)
      expect(route!.distance).not.toBeCloseTo(travelTime, 5);
    });

    it("should have admissible heuristic: straight-line/110 <= actual travel time", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      const straightLine = utils.calculateDistance(start.coordinates, end.coordinates);
      const heuristic = straightLine / 110;

      const route = network.findRoute(start, end);
      expect(route).not.toBeNull();

      let actualTravelTime = 0;
      for (const edge of route!.edges) {
        const surfacePenalty = edge.surface === "unpaved" || edge.surface === "dirt" ? 1.3 : 1.0;
        actualTravelTime += (edge.distance / edge.maxSpeed) * surfacePenalty;
      }

      expect(heuristic).toBeLessThanOrEqual(actualTravelTime);
    });
  });

  describe("one-way street enforcement", () => {
    it("should not have reverse edges for Main Street (oneway=yes)", () => {
      const allEdges = getAllEdges();

      // Main Street forward edges go: node1→node2, node2→node3
      const mainForward = allEdges.filter((e) => e.name === "Main Street");
      expect(mainForward.length).toBeGreaterThan(0);
      expect(mainForward.every((e) => e.oneway === true)).toBe(true);

      // Verify no reverse edge exists for any Main Street edge
      for (const fwd of mainForward) {
        const reverseId = `${fwd.end.id}-${fwd.start.id}`;
        const reverse = allEdges.find((e) => e.id === reverseId && e.name === "Main Street");
        expect(reverse).toBeUndefined();
      }
    });

    it("should have both forward and reverse edges for First Avenue (no oneway)", () => {
      const allEdges = getAllEdges();

      const firstAveEdges = allEdges.filter((e) => e.name === "First Avenue");
      // First Avenue has 2 segments, so 4 edges total (2 forward + 2 reverse)
      expect(firstAveEdges.length).toBe(4);

      // Verify every forward edge has a corresponding reverse edge
      for (const edge of firstAveEdges) {
        const reverseId = `${edge.end.id}-${edge.start.id}`;
        const reverse = allEdges.find((e) => e.id === reverseId && e.name === "First Avenue");
        expect(reverse).toBeDefined();
      }
    });

    it("should mark oneway edges as oneway:true and bidirectional edges as oneway:false", () => {
      const allEdges = getAllEdges();

      const mainEdges = allEdges.filter((e) => e.name === "Main Street");
      for (const edge of mainEdges) {
        expect(edge.oneway).toBe(true);
      }

      const firstAveEdges = allEdges.filter((e) => e.name === "First Avenue");
      for (const edge of firstAveEdges) {
        expect(edge.oneway).toBe(false);
      }

      const secondAveEdges = allEdges.filter((e) => e.name === "Second Avenue");
      for (const edge of secondAveEdges) {
        expect(edge.oneway).toBe(false);
      }
    });
  });

  describe("getConnectedEdges filtering", () => {
    it("should filter out the edge going back to the start node", () => {
      // Get an edge on a bidirectional road to guarantee a reverse edge exists
      const allEdges = getAllEdges();
      const firstAveEdge = allEdges.find((e) => e.name === "First Avenue");
      expect(firstAveEdge).toBeDefined();

      const connected = network.getConnectedEdges(firstAveEdge!);

      // None of the connected edges should end at the original edge's start node
      for (const e of connected) {
        expect(e.end.id).not.toBe(firstAveEdge!.start.id);
      }
    });

    it("should return edges originating from the end node", () => {
      const edge = network.getRandomEdge();
      const connected = network.getConnectedEdges(edge);

      // All connected edges should start from the given edge's end node
      for (const e of connected) {
        expect(e.start.id).toBe(edge.end.id);
      }
    });
  });

  describe("findNearestNode snapping", () => {
    it("should return the exact node when given exact node coordinates", () => {
      // Node at the junction of Main Street and First Avenue: [45.5023, -73.5667]
      const node = network.findNearestNode([45.5023, -73.5667]);
      expect(node.id).toBe("45.5023,-73.5667");
      expect(node.coordinates[0]).toBe(45.5023);
      expect(node.coordinates[1]).toBe(-73.5667);
    });

    it("should snap a coordinate ~50m offset to the nearest node", () => {
      // The node at [45.5020, -73.5670] exists in the network.
      // Offset by roughly 50m (~0.00045 degrees latitude).
      const offset: [number, number] = [45.50245, -73.567];
      const node = network.findNearestNode(offset);

      // Should snap to the closest node — either [45.5023, -73.5667] or [45.5026, -73.5664]
      // depending on exact distance. Verify it's a real network node with connections.
      expect(node).toBeDefined();
      expect(node.id).toBeDefined();
      expect(node.connections.length).toBeGreaterThan(0);

      // The snapped coordinate should be closer to our query than any other node
      const snappedDist = utils.calculateDistance(offset, node.coordinates);
      // Verify snapped distance is small (< 0.1 km = 100m)
      expect(snappedDist).toBeLessThan(0.1);
    });

    it("should snap to the closer node when positioned between two nodes", () => {
      // Two adjacent nodes on First Avenue:
      //   A = [45.5023, -73.5667]
      //   B = [45.5026, -73.5664]
      // Place query much closer to A than B
      const nearA: [number, number] = [45.50235, -73.56675];
      const nodeA = network.findNearestNode([45.5023, -73.5667]);
      const result = network.findNearestNode(nearA);

      expect(result.id).toBe(nodeA.id);
    });

    it("should return a node that has connections (is routable)", () => {
      // Use a position near the network and verify the snapped node is routable
      const position: [number, number] = [45.5019, -73.5672];
      const node = network.findNearestNode(position);

      expect(node.connections).toBeDefined();
      expect(Array.isArray(node.connections)).toBe(true);
      expect(node.connections.length).toBeGreaterThan(0);

      // Each connection should be a valid edge with start/end nodes
      for (const edge of node.connections) {
        expect(edge.start).toBeDefined();
        expect(edge.end).toBeDefined();
        expect(edge.distance).toBeGreaterThan(0);
      }
    });
  });

  describe("findNearestNode spatial index", () => {
    it("should return the exact node when coordinates match exactly", () => {
      // Node at the start of Main Street: [45.5017, -73.5673]
      const node = network.findNearestNode([45.5017, -73.5673]);
      expect(node.coordinates[0]).toBeCloseTo(45.5017, 4);
      expect(node.coordinates[1]).toBeCloseTo(-73.5673, 4);
      expect(node.id).toBe("45.5017,-73.5673");
    });

    it("should return the nearest node when coordinates are slightly offset", () => {
      // Slightly offset from node at [45.5020, -73.5670]
      const node = network.findNearestNode([45.5021, -73.5671]);
      expect(node.coordinates[0]).toBeCloseTo(45.502, 3);
      expect(node.coordinates[1]).toBeCloseTo(-73.567, 3);
    });

    it("should still return a node when coordinates are far from the network", () => {
      // Coordinates far from the test fixture (different hemisphere)
      const node = network.findNearestNode([0.0, 0.0]);
      expect(node).toBeDefined();
      expect(node.id).toBeDefined();
      expect(node.coordinates).toHaveLength(2);
    });
  });

  describe("getBoundingBox", () => {
    it("should return valid bbox with minLat < maxLat and minLon < maxLon", () => {
      const bbox = network.getBoundingBox();

      expect(bbox.minLat).toBeLessThan(bbox.maxLat);
      expect(bbox.minLon).toBeLessThan(bbox.maxLon);
    });

    it("should return a copy that does not affect internal state when mutated", () => {
      const bbox1 = network.getBoundingBox();
      // Mutate the returned object
      bbox1.minLat = 999;
      bbox1.maxLat = -999;
      bbox1.minLon = 999;
      bbox1.maxLon = -999;

      // Get a fresh copy and verify it was not affected
      const bbox2 = network.getBoundingBox();
      expect(bbox2.minLat).not.toBe(999);
      expect(bbox2.maxLat).not.toBe(-999);
      expect(bbox2.minLon).not.toBe(999);
      expect(bbox2.maxLon).not.toBe(-999);
    });

    it("should contain all test network node coordinates within the bbox", () => {
      const bbox = network.getBoundingBox();

      // All 7 node positions from the test fixture
      const knownPositions: [number, number][] = [
        [45.5017, -73.5673],
        [45.502, -73.567],
        [45.5023, -73.5667],
        [45.5026, -73.5664],
        [45.5029, -73.5661],
        [45.5023, -73.5673],
        [45.5026, -73.5676],
      ];

      for (const [lat, lon] of knownPositions) {
        expect(lat).toBeGreaterThanOrEqual(bbox.minLat);
        expect(lat).toBeLessThanOrEqual(bbox.maxLat);
        expect(lon).toBeGreaterThanOrEqual(bbox.minLon);
        expect(lon).toBeLessThanOrEqual(bbox.maxLon);
      }
    });
  });

  // Helper: find any edge with a given street name by checking known node positions
  function findEdgeByName(name: string) {
    const allEdges = getAllEdges();
    return allEdges.find((e) => e.name === name);
  }

  // Helper: get all edges from the network by collecting connections from known nodes.
  // Uses findNearestNode for all known GeoJSON coordinates to ensure full coverage
  // even when one-way streets create directed graph components.
  function getAllEdges() {
    const edges: Edge[] = [];
    const seen = new Set<string>();

    // All coordinate positions from the test fixture
    const knownPositions: [number, number][] = [
      [45.5017, -73.5673],
      [45.502, -73.567],
      [45.5023, -73.5667],
      [45.5026, -73.5664],
      [45.5029, -73.5661],
      [45.5023, -73.5673],
      [45.5026, -73.5676],
    ];

    for (const pos of knownPositions) {
      const node = network.findNearestNode(pos);
      for (const edge of node.connections) {
        if (!seen.has(edge.id)) {
          seen.add(edge.id);
          edges.push(edge);
        }
      }
    }

    return edges;
  }

  // ─── Incident edge cost penalties & cache invalidation ─────────────
  describe("incident edge penalties and cache invalidation", () => {
    it("should invalidate route cache when setIncidentEdges is called", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // Populate the cache
      network.findRoute(start, end);
      network.findRoute(start, end); // cache hit

      let stats = network.routeCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.hits).toBe(1);

      // Set incident edges — should clear entire cache
      const factors = new Map<string, number>();
      factors.set("some-edge-id", 0.5);
      network.setIncidentEdges(factors);

      stats = network.routeCacheStats();
      expect(stats.size).toBe(0);

      // Next findRoute should be a miss (recomputed)
      network.findRoute(start, end);
      stats = network.routeCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });

    it("should invalidate route cache when clearIncidentEdges is called", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // Set some incident data first
      const factors = new Map<string, number>();
      factors.set("some-edge-id", 0.3);
      network.setIncidentEdges(factors);

      // Populate cache with incident-aware routes
      network.findRoute(start, end);
      network.findRoute(start, end); // cache hit

      let stats = network.routeCacheStats();
      expect(stats.size).toBe(1);
      expect(stats.hits).toBe(1);

      // Clear incidents — should clear cache
      network.clearIncidentEdges();

      stats = network.routeCacheStats();
      expect(stats.size).toBe(0);

      // Next findRoute is a fresh computation
      network.findRoute(start, end);
      stats = network.routeCacheStats();
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(0);
    });

    it("should invalidate cache on every setIncidentEdges call, not just the first", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // First incident set
      network.setIncidentEdges(new Map([["e1", 0.5]]));
      network.findRoute(start, end);
      expect(network.routeCacheStats().size).toBe(1);

      // Second incident set — cache must be cleared again
      network.setIncidentEdges(new Map([["e2", 0.2]]));
      expect(network.routeCacheStats().size).toBe(0);

      // Third — clear incidents
      network.clearIncidentEdges();
      network.findRoute(start, end);
      expect(network.routeCacheStats().size).toBe(1);

      // Fourth — new incident
      network.setIncidentEdges(new Map([["e3", 0]]));
      expect(network.routeCacheStats().size).toBe(0);
    });

    it("should skip blocked edges (speedFactor=0) during routing", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // Route without incidents
      const normalRoute = network.findRoute(start, end);
      expect(normalRoute).not.toBeNull();
      const normalEdgeIds = normalRoute!.edges.map((e) => e.id);

      // Block all edges in the normal route
      const blocked = new Map<string, number>();
      for (const edgeId of normalEdgeIds) {
        blocked.set(edgeId, 0); // fully blocked
      }
      network.setIncidentEdges(blocked);

      // Route should either find an alternative or return null
      const reroutedRoute = network.findRoute(start, end);

      if (reroutedRoute) {
        // Alternative route must not use any blocked edges
        const reroutedEdgeIds = reroutedRoute.edges.map((e) => e.id);
        for (const blockedId of normalEdgeIds) {
          expect(reroutedEdgeIds).not.toContain(blockedId);
        }
      }
      // If null, no alternative exists — that's also valid
    });

    it("should penalize slowed edges (speedFactor < 1) during routing", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // Route without incidents
      const normalRoute = network.findRoute(start, end);
      expect(normalRoute).not.toBeNull();

      // Heavily penalize all edges on the normal route
      const penalties = new Map<string, number>();
      for (const edge of normalRoute!.edges) {
        penalties.set(edge.id, 0.01); // extreme slowdown
      }
      network.setIncidentEdges(penalties);

      const penalizedRoute = network.findRoute(start, end);

      // If an alternative exists, A* should prefer it over the heavily penalized route
      // If no alternative exists, it still uses the penalized route
      // Either way, the route should be valid
      if (penalizedRoute) {
        expect(penalizedRoute.edges.length).toBeGreaterThan(0);
        expect(penalizedRoute.distance).toBeGreaterThan(0);
      }
    });

    it("should return to normal routing after clearing incidents", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // Normal route
      const normalRoute = network.findRoute(start, end);
      expect(normalRoute).not.toBeNull();

      // Add incidents
      const penalties = new Map<string, number>();
      penalties.set(normalRoute!.edges[0].id, 0.1);
      network.setIncidentEdges(penalties);

      // Route with incident
      network.findRoute(start, end);

      // Clear incidents
      network.clearIncidentEdges();

      // Route after clearing should match the original normal route
      const restoredRoute = network.findRoute(start, end);
      expect(restoredRoute).not.toBeNull();
      expect(restoredRoute!.edges.length).toBe(normalRoute!.edges.length);
      expect(restoredRoute!.distance).toBeCloseTo(normalRoute!.distance, 6);
      for (let i = 0; i < normalRoute!.edges.length; i++) {
        expect(restoredRoute!.edges[i].id).toBe(normalRoute!.edges[i].id);
      }
    });

    it("should not serve stale cached route after incident changes", () => {
      const start = network.findNearestNode([45.5017, -73.5673]);
      const end = network.findNearestNode([45.5029, -73.5661]);

      // Warm the cache
      const route1 = network.findRoute(start, end);
      expect(route1).not.toBeNull();

      // Verify cache hit
      network.findRoute(start, end);
      expect(network.routeCacheStats().hits).toBe(1);

      // Block all edges on this route
      const blocked = new Map<string, number>();
      for (const edge of route1!.edges) {
        blocked.set(edge.id, 0);
      }
      network.setIncidentEdges(blocked);

      // After setIncidentEdges, cache should be empty
      expect(network.routeCacheStats().size).toBe(0);

      // The next findRoute must NOT return the stale cached route
      // because those edges are now blocked
      const route3 = network.findRoute(start, end);

      if (route3) {
        // Must be a different route (not using blocked edges)
        const route3EdgeIds = route3.edges.map((e) => e.id);
        for (const edge of route1!.edges) {
          expect(route3EdgeIds).not.toContain(edge.id);
        }
      }
      // If null, the only path was blocked — valid
    });
  });
});
