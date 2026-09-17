/**
 * Geometry invariants for the procedural vehicle meshes.
 *
 * These assert the things that are invisible until they are catastrophic: a
 * normal that points the wrong way only shows up once someone enables back-face
 * culling, and a stray index past the end of the position buffer is a GPU-side
 * crash with no useful stack.
 */
import { describe, it, expect } from "vitest";
import {
  VEHICLE_MESHES,
  MESH_VEHICLE_TYPES,
  MESH_REFERENCE_LENGTH_M,
  buildMesh,
  meshTypeFor,
  FALLBACK_MESH_TYPE,
  type VehicleMesh,
} from "./vehicleMeshes";

/** The per-model triangle budget the design was chosen against. */
const MAX_TRIANGLES = 60;

function vertexCount(mesh: VehicleMesh): number {
  return mesh.attributes.POSITION.value.length / 3;
}

function triangleCount(mesh: VehicleMesh): number {
  return mesh.indices.value.length / 3;
}

describe("vehicle meshes", () => {
  it("has a mesh for every type the simulator emits", () => {
    expect(MESH_VEHICLE_TYPES.sort()).toEqual(
      ["ambulance", "bus", "car", "motorcycle", "truck"].sort()
    );
  });

  it.each(MESH_VEHICLE_TYPES)("%s: attribute buffers agree on vertex count", (type) => {
    const mesh = VEHICLE_MESHES[type];
    const n = vertexCount(mesh);
    expect(n).toBeGreaterThan(0);
    expect(mesh.attributes.NORMAL.value.length).toBe(n * 3);
    expect(mesh.attributes.COLOR_0.value.length).toBe(n * 3);
  });

  it.each(MESH_VEHICLE_TYPES)("%s: every index is in range", (type) => {
    const mesh = VEHICLE_MESHES[type];
    const n = vertexCount(mesh);
    expect(mesh.indices.value.length % 3).toBe(0);
    for (const i of mesh.indices.value) {
      expect(i).toBeLessThan(n);
    }
  });

  it.each(MESH_VEHICLE_TYPES)("%s: every normal is a unit vector", (type) => {
    const normals = VEHICLE_MESHES[type].attributes.NORMAL.value;
    for (let i = 0; i < normals.length; i += 3) {
      const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it.each(MESH_VEHICLE_TYPES)("%s: nothing sits below the ground plane", (type) => {
    const positions = VEHICLE_MESHES[type].attributes.POSITION.value;
    for (let i = 2; i < positions.length; i += 3) {
      expect(positions[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(MESH_VEHICLE_TYPES)("%s: draws no downward-facing face", (type) => {
    // The bottom face is omitted on purpose: it is never visible from above and
    // at z=0 it would be coplanar with the road PathLayer and z-fight with it.
    const normals = VEHICLE_MESHES[type].attributes.NORMAL.value;
    for (let i = 0; i < normals.length; i += 3) {
      expect(normals[i + 2]).toBeGreaterThan(-0.99);
    }
  });

  it.each(MESH_VEHICLE_TYPES)("%s: stays inside the triangle budget", (type) => {
    expect(triangleCount(VEHICLE_MESHES[type])).toBeLessThanOrEqual(MAX_TRIANGLES);
  });

  it.each(MESH_VEHICLE_TYPES)("%s: keeps every part close to the fleet colour", (type) => {
    // Tints multiply the per-instance colour. Far above 1 clips a light fleet
    // colour to white; far below it, the vehicle reads as a dark blob with a
    // coloured rim rather than a coloured vehicle, which is what the first
    // near-black glass/tyre pass actually looked like on the map.
    const colors = VEHICLE_MESHES[type].attributes.COLOR_0.value;
    for (const c of colors) {
      expect(c).toBeGreaterThanOrEqual(0.5);
      expect(c).toBeLessThanOrEqual(1.2);
    }
  });

  it("sizes the car to the documented reference length", () => {
    const positions = VEHICLE_MESHES.car.attributes.POSITION.value;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < positions.length; i += 3) {
      minY = Math.min(minY, positions[i]);
      maxY = Math.max(maxY, positions[i]);
    }
    expect(maxY - minY).toBeCloseTo(MESH_REFERENCE_LENGTH_M, 5);
  });

  it("points every model forward along +y", () => {
    // Yaw 0 must mean "heading north". A model that is longer across than along
    // would be drawn broadside to its direction of travel.
    for (const type of MESH_VEHICLE_TYPES) {
      const positions = VEHICLE_MESHES[type].attributes.POSITION.value;
      let spanX = 0;
      let spanY = 0;
      for (let i = 0; i < positions.length; i += 3) {
        spanX = Math.max(spanX, Math.abs(positions[i]));
        spanY = Math.max(spanY, Math.abs(positions[i + 1]));
      }
      expect(spanY).toBeGreaterThan(spanX);
    }
  });

  describe("normal orientation", () => {
    it("points a lone box's faces away from its centre", () => {
      const mesh = buildMesh([{ cx: 0, cy: 0, z: 0, sx: 2, sy: 4, sz: 1, tint: [1, 1, 1] }]);
      const positions = mesh.attributes.POSITION.value;
      const normals = mesh.attributes.NORMAL.value;
      const centre = [0, 0, 0.5];

      // One normal per face, so step a quad (4 vertices) at a time.
      for (let v = 0; v < vertexCount(mesh); v += 4) {
        let fx = 0;
        let fy = 0;
        let fz = 0;
        for (let k = 0; k < 4; k++) {
          fx += positions[(v + k) * 3];
          fy += positions[(v + k) * 3 + 1];
          fz += positions[(v + k) * 3 + 2];
        }
        const dx = fx / 4 - centre[0];
        const dy = fy / 4 - centre[1];
        const dz = fz / 4 - centre[2];
        const dot = normals[v * 3] * dx + normals[v * 3 + 1] * dy + normals[v * 3 + 2] * dz;
        expect(dot).toBeGreaterThan(0);
      }
    });

    it("keeps an asymmetrically tapered box's faces outward", () => {
      // A raked windscreen is a large insetFront against a small insetBack.
      const mesh = buildMesh([
        {
          cx: 0,
          cy: 0,
          z: 0,
          sx: 2,
          sy: 4,
          sz: 1.2,
          insetX: 0.3,
          insetFront: 1.4,
          insetBack: 0.3,
          tint: [1, 1, 1],
        },
      ]);
      const normals = mesh.attributes.NORMAL.value;
      expect(normals[2]).toBeCloseTo(1, 5); // top still faces up
      for (let v = 4; v < vertexCount(mesh); v += 4) {
        // Every side leans outward and upward, none folds back on itself.
        expect(normals[v * 3 + 2]).toBeGreaterThan(0);
      }
    });

    it("keeps a tapered box's faces outward too", () => {
      const mesh = buildMesh([
        { cx: 0, cy: 0, z: 0, sx: 2, sy: 4, sz: 2, insetX: 0.5, insetY: 0.9, tint: [1, 1, 1] },
      ]);
      const normals = mesh.attributes.NORMAL.value;
      // The four side faces of a tapered box all lean outward and upward.
      const top = [normals[0], normals[1], normals[2]];
      expect(top[2]).toBeCloseTo(1, 5);
      for (let v = 4; v < vertexCount(mesh); v += 4) {
        expect(normals[v * 3 + 2]).toBeGreaterThan(0);
      }
    });
  });

  describe("asymmetric taper", () => {
    it("rakes the front more than the back when asked", () => {
      const mesh = buildMesh([
        {
          cx: 0,
          cy: 0,
          z: 0,
          sx: 1,
          sy: 4,
          sz: 1,
          insetFront: 1.5,
          insetBack: 0.2,
          tint: [1, 1, 1],
        },
      ]);
      const positions = mesh.attributes.POSITION.value;
      let topFront = -Infinity;
      let topBack = Infinity;
      for (let i = 0; i < positions.length; i += 3) {
        if (positions[i + 2] < 1) continue; // base ring, not the top face
        topFront = Math.max(topFront, positions[i + 1]);
        topBack = Math.min(topBack, positions[i + 1]);
      }
      // Base is +/-2. The front edge pulls in by 1.5, the back by 0.2.
      expect(topFront).toBeCloseTo(0.5, 5);
      expect(topBack).toBeCloseTo(-1.8, 5);
    });

    it("treats insetY as both ends, and lets one end override it", () => {
      const both = buildMesh([
        { cx: 0, cy: 0, z: 0, sx: 1, sy: 4, sz: 1, insetY: 0.5, tint: [1, 1, 1] },
      ]);
      const overridden = buildMesh([
        { cx: 0, cy: 0, z: 0, sx: 1, sy: 4, sz: 1, insetY: 0.5, insetFront: 1.2, tint: [1, 1, 1] },
      ]);
      const topY = (m: typeof both) => {
        const p = m.attributes.POSITION.value;
        let max = -Infinity;
        for (let i = 0; i < p.length; i += 3) {
          if (p[i + 2] >= 1) max = Math.max(max, p[i + 1]);
        }
        return max;
      };
      expect(topY(both)).toBeCloseTo(1.5, 5);
      expect(topY(overridden)).toBeCloseTo(0.8, 5);
    });
  });

  describe("meshTypeFor", () => {
    it.each(MESH_VEHICLE_TYPES)("passes %s through", (type) => {
      expect(meshTypeFor(type)).toBe(type);
    });

    it("falls back for an unknown type", () => {
      expect(meshTypeFor("hovercraft")).toBe(FALLBACK_MESH_TYPE);
    });

    it("falls back for a missing type", () => {
      expect(meshTypeFor(undefined)).toBe(FALLBACK_MESH_TYPE);
    });
  });
});
