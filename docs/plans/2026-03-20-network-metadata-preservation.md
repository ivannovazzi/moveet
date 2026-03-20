# Network Metadata Preservation & Search Quality

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the OSM data pipeline so POIs, traffic signals, turn restrictions, and residential roads survive into the final GeoJSON, then fix search to support English names and the amenity tag.

**Architecture:** Three layers of fixes: (1) network pipeline — add node/relation filter expressions and remove geometry-type restriction, (2) simulator graph builder — index `name:en` alongside `name` for multilingual search, (3) simulator POI detection — add `amenity` tag support. Each layer is independently testable.

**Tech Stack:** TypeScript, osmium-tool CLI, vitest, GeoJSON

---

## Group A: Network Pipeline Fixes (apps/network)

### Task 1: Add residential/living_street to default road classes

**Beads:** fleetsim-all-ckwt

**Files:**

- Modify: `apps/network/src/commands/filter.ts:4-11`
- Create: `apps/network/src/__tests__/filter.test.ts`

**Step 1: Write the failing test**

Create `apps/network/src/__tests__/filter.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildFilterArgs, DEFAULT_ROAD_CLASSES } from "../commands/filter.js";

describe("filter", () => {
  describe("DEFAULT_ROAD_CLASSES", () => {
    it("should include residential and living_street", () => {
      expect(DEFAULT_ROAD_CLASSES).toContain("residential");
      expect(DEFAULT_ROAD_CLASSES).toContain("living_street");
    });
  });

  describe("buildFilterArgs", () => {
    it("should produce w/ expressions for each class plus roundabout", () => {
      const args = buildFilterArgs({
        input: "/cache/region.osm.pbf",
        output: "/cache/region-roads.osm.pbf",
      });
      expect(args[0]).toBe("tags-filter");
      // Every default class should be a w/highway= expression
      for (const cls of DEFAULT_ROAD_CLASSES) {
        expect(args).toContain(`w/highway=${cls}`);
      }
      expect(args).toContain("w/junction=roundabout");
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/network && npx vitest run src/__tests__/filter.test.ts`
Expected: FAIL — `residential` not in DEFAULT_ROAD_CLASSES

**Step 3: Add residential and living_street to DEFAULT_ROAD_CLASSES**

In `apps/network/src/commands/filter.ts`, add `"residential"` and `"living_street"` to the array.

**Step 4: Run test to verify it passes**

Run: `cd apps/network && npx vitest run src/__tests__/filter.test.ts`
Expected: PASS

---

### Task 2: Add POI and infrastructure node filters

**Beads:** fleetsim-all-4njb

**Files:**

- Modify: `apps/network/src/commands/filter.ts`
- Modify: `apps/network/src/__tests__/filter.test.ts`

The osmium `w/` prefix means ways-only. We need `n/` (node) expressions for POIs and traffic infra, plus `r/` (relation) for turn restrictions.

**Step 1: Write the failing tests**

Add to `apps/network/src/__tests__/filter.test.ts`:

```typescript
describe("buildFilterArgs — node and relation expressions", () => {
  it("should include node filters for POIs and traffic signals", () => {
    const args = buildFilterArgs({
      input: "/cache/region.osm.pbf",
      output: "/cache/region-roads.osm.pbf",
    });
    // POI nodes
    expect(args).toContain("n/amenity");
    expect(args).toContain("n/shop");
    expect(args).toContain("n/leisure");
    expect(args).toContain("n/craft");
    expect(args).toContain("n/office");
    // Traffic infra nodes
    expect(args).toContain("n/highway=traffic_signals");
    expect(args).toContain("n/highway=bus_stop");
  });

  it("should include relation filter for turn restrictions", () => {
    const args = buildFilterArgs({
      input: "/cache/region.osm.pbf",
      output: "/cache/region-roads.osm.pbf",
    });
    expect(args).toContain("r/type=restriction");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/network && npx vitest run src/__tests__/filter.test.ts`
Expected: FAIL — no `n/amenity` in args

**Step 3: Add node and relation expressions to buildFilterArgs**

In `apps/network/src/commands/filter.ts`, add the POI node expressions, traffic infra, and relation expressions after the highway way expressions:

```typescript
export function buildFilterArgs(opts: FilterOptions): string[] {
  const classes = opts.classes ?? DEFAULT_ROAD_CLASSES;
  const highwayExprs = [...classes].map((c) => `w/highway=${c}`);
  return [
    "tags-filter",
    path.basename(opts.input),
    // Road ways
    ...highwayExprs,
    "w/junction=roundabout",
    // POI nodes
    "n/amenity",
    "n/shop",
    "n/leisure",
    "n/craft",
    "n/office",
    // Traffic infrastructure nodes
    "n/highway=traffic_signals",
    "n/highway=bus_stop",
    // Turn restriction relations
    "r/type=restriction",
    "-o",
    path.basename(opts.output),
    "--overwrite",
  ];
}
```

**Step 4: Run test to verify it passes**

Run: `cd apps/network && npx vitest run src/__tests__/filter.test.ts`
Expected: PASS

---

### Task 3: Fix export to include Point geometry types

**Beads:** fleetsim-all-9opb, fleetsim-all-5igx

**Files:**

- Modify: `apps/network/src/commands/export.ts:23`
- Create: `apps/network/src/__tests__/export.test.ts`

**Step 1: Write the failing test**

Create `apps/network/src/__tests__/export.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildExportArgs, buildMetadata } from "../commands/export.js";

describe("export", () => {
  describe("buildExportArgs", () => {
    it("should include both linestring and point geometry types", () => {
      const args = buildExportArgs({
        input: "/cache/region-roads.osm.pbf",
        output: "/cache/network.geojson",
      });
      const geomArg = args.find((a) => a.startsWith("--geometry-types="));
      expect(geomArg).toBeDefined();
      expect(geomArg).toContain("linestring");
      expect(geomArg).toContain("point");
    });

    it("should output geojson format", () => {
      const args = buildExportArgs({
        input: "/cache/region-roads.osm.pbf",
        output: "/cache/network.geojson",
      });
      expect(args).toContain("--output-format=geojson");
    });
  });

  describe("buildMetadata", () => {
    it("should include region, bbox, classes, and generatedAt", () => {
      const meta = buildMetadata({
        region: "cairo",
        bbox: [31.1, 29.9, 31.7, 30.2],
        classes: ["motorway", "trunk"],
      });
      expect(meta.region).toBe("cairo");
      expect(meta.bbox).toEqual([31.1, 29.9, 31.7, 30.2]);
      expect(meta.classes).toEqual(["motorway", "trunk"]);
      expect(meta.generatedAt).toBeDefined();
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd apps/network && npx vitest run src/__tests__/export.test.ts`
Expected: FAIL — geometry types is `linestring` only, not `linestring,point`

**Step 3: Change geometry types to include point**

In `apps/network/src/commands/export.ts` line 23, change:

```typescript
"--geometry-types=linestring",
```

to:

```typescript
"--geometry-types=linestring,point",
```

**Step 4: Run test to verify it passes**

Run: `cd apps/network && npx vitest run src/__tests__/export.test.ts`
Expected: PASS

---

### Task 4: Update prune to preserve non-LineString features

**Beads:** N/A (prune already does this — line 81-83 keeps non-LineString features as-is)

No changes needed. The prune step already has: `if (feature.geometry.type !== "LineString") { kept.push(feature); continue; }`. Points will pass through.

Create a test to document this contract:

**Files:**

- Create: `apps/network/src/__tests__/prune.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from "vitest";
import { pruneNetwork } from "../commands/prune.js";
import type { FeatureCollection } from "geojson";

describe("prune", () => {
  it("should preserve Point features (POIs) through pruning", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { highway: "primary", name: "Main St" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
        {
          type: "Feature",
          properties: { amenity: "fuel", name: "Gas Station" },
          geometry: {
            type: "Point",
            coordinates: [0.5, 0.5],
          },
        },
      ],
    };

    const { pruned } = pruneNetwork(fc);
    const points = pruned.features.filter((f) => f.geometry.type === "Point");
    expect(points).toHaveLength(1);
    expect(points[0].properties?.name).toBe("Gas Station");
  });

  it("should remove disconnected LineString features", () => {
    const fc: FeatureCollection = {
      type: "FeatureCollection",
      features: [
        // Connected component (2 features sharing a node)
        {
          type: "Feature",
          properties: { highway: "primary" },
          geometry: {
            type: "LineString",
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
        },
        {
          type: "Feature",
          properties: { highway: "primary" },
          geometry: {
            type: "LineString",
            coordinates: [
              [1, 1],
              [2, 2],
            ],
          },
        },
        // Disconnected single feature
        {
          type: "Feature",
          properties: { highway: "tertiary" },
          geometry: {
            type: "LineString",
            coordinates: [
              [10, 10],
              [11, 11],
            ],
          },
        },
      ],
    };

    const { pruned, removedFeatures } = pruneNetwork(fc);
    const lines = pruned.features.filter(
      (f) => f.geometry.type === "LineString",
    );
    expect(lines).toHaveLength(2);
    expect(removedFeatures).toBe(1);
  });
});
```

**Step 2: Run test**

Run: `cd apps/network && npx vitest run src/__tests__/prune.test.ts`
Expected: PASS (prune already preserves Points)

---

## Group B: Simulator Fixes (apps/simulator)

### Task 5: Add amenity tag to POI type detection

**Beads:** fleetsim-all-zdxc

**Files:**

- Modify: `apps/simulator/src/modules/RoadNetwork.ts:230-246`
- Modify: `apps/simulator/src/__tests__/fixtures/test-network.geojson` (add amenity POI)
- Modify: `apps/simulator/src/__tests__/RoadNetwork.test.ts`

**Step 1: Add amenity POI to test fixture**

Add a new Point feature to `test-network.geojson` with `amenity: "fuel"`:

```json
{
  "type": "Feature",
  "properties": {
    "id": "poi-fuel",
    "name": "Cairo Fuel Station",
    "amenity": "fuel"
  },
  "geometry": {
    "type": "Point",
    "coordinates": [-73.5664, 45.5026]
  }
}
```

**Step 2: Write the failing test**

Add to `RoadNetwork.test.ts` in the `getAllPOIs` describe block:

```typescript
it("should detect amenity-tagged POIs", () => {
  const pois = network.getAllPOIs();
  const fuelPoi = pois.find((p) => p.name === "Cairo Fuel Station");
  expect(fuelPoi).toBeDefined();
  expect(fuelPoi?.type).toBe("fuel");
});
```

**Step 3: Run test to verify it fails**

Run: `cd apps/simulator && npx vitest run src/__tests__/RoadNetwork.test.ts -t "should detect amenity-tagged POIs"`
Expected: FAIL — amenity not detected by getPoiType()

**Step 4: Add amenity detection to getPoiType()**

In `RoadNetwork.ts`, add amenity check as the FIRST check in `getPoiType()`:

```typescript
private getPoiType(feature: Feature): string | null {
  if (feature.properties?.amenity) {
    return feature.properties.amenity;
  }
  if (feature.properties?.shop) {
    return "shop";
  }
  // ... rest unchanged
}
```

**Step 5: Run test to verify it passes**

Run: `cd apps/simulator && npx vitest run src/__tests__/RoadNetwork.test.ts -t "should detect amenity-tagged POIs"`
Expected: PASS

---

### Task 6: Index name:en for multilingual search

**Beads:** fleetsim-all-lzn6

**Files:**

- Modify: `apps/simulator/src/modules/RoadNetwork.ts:21-26` (Road interface)
- Modify: `apps/simulator/src/modules/RoadNetwork.ts:284` (streetName extraction)
- Modify: `apps/simulator/src/modules/RoadNetwork.ts:328-338` (road indexing)
- Modify: `apps/simulator/src/modules/RoadNetwork.ts:838-861` (searchByName)
- Modify: `apps/simulator/src/__tests__/fixtures/test-network.geojson`
- Modify: `apps/simulator/src/__tests__/RoadNetwork.test.ts`

**Step 1: Add multilingual road names to test fixture**

Modify existing roads in `test-network.geojson` to include `name:en`:

For the first road, add `"name:en": "Main Street EN"` alongside the existing `"name": "Main Street"`.

Add a new road with Arabic name and English translation:

```json
{
  "type": "Feature",
  "properties": {
    "id": "road-arabic",
    "name": "شارع العروبه",
    "name:en": "Al Orouba Street",
    "highway": "trunk"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [-73.5676, 45.5026],
      [-73.5679, 45.5029],
      [-73.5682, 45.5032]
    ]
  }
}
```

**Step 2: Write failing tests**

Add to `RoadNetwork.test.ts` in the `searchByName` describe block:

```typescript
it("should find roads by name:en (English name)", () => {
  const results = network.searchByName("Orouba");
  expect(results.length).toBeGreaterThan(0);
  expect(results[0].name).toContain("شارع العروبه");
});

it("should find roads by either native name or English name", () => {
  const arabicResults = network.searchByName("العروبه");
  const englishResults = network.searchByName("Orouba");
  // Both should find the same road
  expect(arabicResults.length).toBeGreaterThan(0);
  expect(englishResults.length).toBeGreaterThan(0);
});
```

**Step 3: Run test to verify it fails**

Run: `cd apps/simulator && npx vitest run src/__tests__/RoadNetwork.test.ts -t "should find roads by name:en"`
Expected: FAIL — English name not indexed

**Step 4: Update Road interface and indexing**

In `RoadNetwork.ts`:

1. Add `nameEn` to the Road interface:

```typescript
interface Road {
  name: string;
  nameEn: string;
  nodeIds: Set<string>;
  streets: Street[];
}
```

2. Extract `name:en` during buildNetwork (around line 284):

```typescript
const streetName = feature.properties?.name || "";
const streetNameEn = feature.properties?.["name:en"] || "";
```

3. Store nameEn when initializing road (around line 330):

```typescript
if (!this.roads.has(streetName)) {
  this.roads.set(streetName, {
    name: streetName,
    nameEn: streetNameEn,
    nodeIds: new Set<string>(),
    streets: [],
  });
}
```

4. Also index by English name if different from native name. Add a second entry in the roads Map keyed by the English name, pointing to the same Road object:

```typescript
if (
  streetNameEn &&
  streetNameEn !== streetName &&
  !this.roads.has(streetNameEn)
) {
  this.roads.set(streetNameEn, this.roads.get(streetName)!);
}
```

5. Update searchByName to also match against `nameEn`:

```typescript
public searchByName(query: string): Array<{
  name: string;
  nameEn: string;
  nodeIds: string[];
  coordinates: [number, number][];
}> {
  const lowerQuery = query.toLowerCase();
  const seen = new Set<string>();
  const results: Array<{
    name: string;
    nameEn: string;
    nodeIds: string[];
    coordinates: [number, number][];
  }> = [];

  for (const [_key, road] of this.roads) {
    // Deduplicate — same Road object may be indexed under both name and name:en
    const roadId = road.name || road.nameEn;
    if (seen.has(roadId)) continue;

    if (
      road.name.toLowerCase().includes(lowerQuery) ||
      road.nameEn.toLowerCase().includes(lowerQuery)
    ) {
      seen.add(roadId);
      results.push({
        name: road.name,
        nameEn: road.nameEn,
        nodeIds: Array.from(road.nodeIds),
        coordinates: road.streets.flat(),
      });
    }
  }

  return results;
}
```

6. Update `getAllRoads()` return type to include `nameEn` and deduplicate.

**Step 5: Run test to verify it passes**

Run: `cd apps/simulator && npx vitest run src/__tests__/RoadNetwork.test.ts -t "searchByName"`
Expected: PASS

---

### Task 7: Run full test suite and fix any regressions

**Step 1:** Run: `cd apps/network && npx vitest run`
**Step 2:** Run: `cd apps/simulator && npx vitest run`
**Step 3:** Fix any failing tests caused by the Road interface change (nameEn addition) or searchByName return type change.

---

### Task 8: Commit and push

Commit all changes across both packages with a descriptive message.
