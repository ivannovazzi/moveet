import { describe, it, expect } from "vitest";
import {
  BUILDING_TILE_ZOOM,
  BuildingTileBuilder,
  COORD_SCALE,
  encodeBuilding,
  lonLatToTile,
  outerRings,
  quantizeRing,
  tileOrigin,
} from "./buildingTiles.js";

/** Reference decoder: the UI's copy lives in apps/ui/src/Map/Buildings. */
function decode(tile: { o: [number, number]; b: number[] }) {
  const out: { height: number; ring: [number, number][] }[] = [];
  let i = 0;
  while (i < tile.b.length) {
    const height = tile.b[i++] / 10;
    const k = tile.b[i++];
    let x = tile.o[0];
    let y = tile.o[1];
    const ring: [number, number][] = [];
    for (let v = 0; v < k; v++) {
      x += tile.b[i++];
      y += tile.b[i++];
      ring.push([x / COORD_SCALE, y / COORD_SCALE]);
    }
    out.push({ height, ring });
  }
  return out;
}

const SQUARE: [number, number][] = [
  [36.8, -1.3],
  [36.8001, -1.3],
  [36.8001, -1.2999],
  [36.8, -1.2999],
  [36.8, -1.3],
];

describe("lonLatToTile / tileOrigin", () => {
  it("matches the standard slippy-map tile for central Nairobi at z14", () => {
    // 36.8219, -1.2921 (Nairobi CBD) is tile 14/9867/8250.
    expect(lonLatToTile(36.8219, -1.2921, 14)).toEqual([9867, 8250]);
  });

  it("puts the origin at the tile's south-west corner", () => {
    const [x, y] = lonLatToTile(36.8219, -1.2921, 14);
    const [ox, oy] = tileOrigin(x, y, 14);
    expect(ox / COORD_SCALE).toBeLessThanOrEqual(36.8219);
    expect(oy / COORD_SCALE).toBeLessThanOrEqual(-1.2921);
    expect(lonLatToTile(ox / COORD_SCALE + 1e-6, oy / COORD_SCALE + 1e-6, 14)).toEqual([x, y]);
  });
});

describe("quantizeRing", () => {
  it("drops the closing vertex", () => {
    expect(quantizeRing(SQUARE)).toHaveLength(4);
  });

  it("drops consecutive duplicates created by rounding", () => {
    const ring: [number, number][] = [
      [36.8, -1.3],
      [36.80000001, -1.3],
      [36.8001, -1.3],
      [36.8001, -1.2999],
      [36.8, -1.3],
    ];
    expect(quantizeRing(ring)).toEqual([
      [36800000, -1300000],
      [36800100, -1300000],
      [36800100, -1299900],
    ]);
  });

  it("rejects rings that collapse below a triangle", () => {
    expect(
      quantizeRing([
        [36.8, -1.3],
        [36.8000001, -1.3],
        [36.8, -1.3],
      ])
    ).toBeNull();
  });
});

describe("encodeBuilding", () => {
  it("writes height in decimetres, the count, then deltas from the origin", () => {
    const out: number[] = [];
    encodeBuilding(
      out,
      [
        [110, 220],
        [130, 220],
        [130, 250],
      ],
      7.25,
      [100, 200]
    );
    expect(out).toEqual([73, 3, 10, 20, 20, 0, 0, 30]);
  });
});

describe("outerRings", () => {
  it("keeps only the outer ring of each polygon", () => {
    const hole: [number, number][] = [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 0],
    ];
    expect(outerRings({ type: "Polygon", coordinates: [SQUARE, hole] })).toEqual([SQUARE]);
    expect(outerRings({ type: "MultiPolygon", coordinates: [[SQUARE, hole], [SQUARE]] })).toEqual([
      SQUARE,
      SQUARE,
    ]);
  });

  it("ignores non-polygon geometry", () => {
    expect(outerRings({ type: "Point", coordinates: [0, 0] })).toEqual([]);
    expect(outerRings(null)).toEqual([]);
  });
});

describe("BuildingTileBuilder", () => {
  it("round-trips footprints and resolved heights through a tile", () => {
    const builder = new BuildingTileBuilder();
    builder.add({
      geometry: { type: "MultiPolygon", coordinates: [[SQUARE]] },
      properties: { building: "yes", "building:levels": "4" },
    });
    expect(builder.count).toBe(1);
    expect(builder.tiles.size).toBe(1);
    const [key, tile] = [...builder.tiles][0];
    expect(key).toBe(lonLatToTile(36.80005, -1.29995, BUILDING_TILE_ZOOM).join("/"));
    const [building] = decode(tile);
    expect(building.height).toBe(12);
    expect(building.ring).toHaveLength(4);
    building.ring.forEach(([lon, lat], i) => {
      expect(lon).toBeCloseTo(SQUARE[i][0], 6);
      expect(lat).toBeCloseTo(SQUARE[i][1], 6);
    });
  });

  it("skips building=no and counts degenerate rings", () => {
    const builder = new BuildingTileBuilder();
    builder.add({
      geometry: { type: "Polygon", coordinates: [SQUARE] },
      properties: { building: "no" },
    });
    builder.add({
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [36.8, -1.3],
            [36.8, -1.3],
          ],
        ],
      },
      properties: { building: "yes" },
    });
    expect(builder.count).toBe(0);
    expect(builder.skipped).toBe(1);
    expect(builder.bbox()).toBeNull();
  });

  it("indexes tiles, count, extent and the OSM source", () => {
    const builder = new BuildingTileBuilder();
    builder.add({
      geometry: { type: "Polygon", coordinates: [SQUARE] },
      properties: { building: "house" },
    });
    const index = builder.index("nairobi");
    expect(index.buildings).toBe(1);
    expect(index.zoom).toBe(BUILDING_TILE_ZOOM);
    expect(index.tiles).toEqual([...builder.tiles.keys()]);
    expect(index.bbox[0]).toBeCloseTo(36.8, 6);
    expect(index.bbox[3]).toBeCloseTo(-1.2999, 6);
    expect(index.source).toMatch(/OpenStreetMap/);
  });
});
