/**
 * Low-poly vehicle meshes for the deck.gl `SimpleMeshLayer`.
 *
 * Built procedurally from tapered boxes rather than loaded from glTF: a
 * handful of boxes per type keeps every model under ~80 triangles, needs no
 * asset pipeline, and avoids shipping a scene-graph parser to the browser for
 * five shapes we can describe in a table.
 *
 * ## Frame of reference
 *
 * `x` is starboard, `y` is forward, `z` is up, all in metres, with the origin
 * at ground level in the centre of the footprint. A mesh therefore points
 * "north" at yaw 0, which matches the compass heading the simulator sends once
 * `VehiclesLayer` negates it for deck.gl's counter-clockwise rotation.
 *
 * ## Why tints are multipliers
 *
 * `SimpleMeshLayer` multiplies each vertex's `COLOR_0` by the per-instance
 * colour from `getColor`. The instance colour is the only per-vehicle input, so
 * a part cannot pick an absolute colour — it can only shade relative to the
 * vehicle's own colour. Every `tint` below is that multiplier: 1 is the fleet
 * colour untouched, 0.15 is a near-black wheel, 1.1 is a highlight. This is
 * what lets one mesh carry dark wheels and dark glass while still being a
 * single instanced draw call per vehicle type.
 *
 * ## Dimensions are display metres, not real ones
 *
 * A real 12 m bus next to a real 4.4 m car is a 2.7x length ratio, which reads
 * as one vehicle swallowing the other at dashboard zoom. The lengths here are
 * compressed towards each other — truthful in order, not in ratio — the same
 * compromise the sprite atlas already makes by drawing a bus that only somewhat
 * outgrows a car.
 */

/** Attribute bundle in the shape `SimpleMeshLayer` accepts for its `mesh` prop. */
export interface VehicleMesh {
  attributes: {
    POSITION: { value: Float32Array; size: 3 };
    NORMAL: { value: Float32Array; size: 3 };
    COLOR_0: { value: Float32Array; size: 3 };
  };
  indices: { value: Uint16Array; size: 1 };
}

/**
 * One tapered box. Parts are assembled in mesh space (metres, z up, origin on
 * the ground at the centre of the footprint).
 */
interface Part {
  /** Footprint centre, metres. `cy` is positive towards the front. */
  cx: number;
  cy: number;
  /** Height of the part's underside above the ground plane, metres. */
  z: number;
  /** Footprint size at the base, metres. */
  sx: number;
  sy: number;
  /** Height, metres. */
  sz: number;
  /** Per-side inset of the top face, metres — how much the box tapers. */
  insetX?: number;
  insetY?: number;
  /** Multiplier on the vehicle's instance colour. See the module comment. */
  tint: [number, number, number];
}

type Vec3 = [number, number, number];

/** Shading multipliers shared across the models, so parts read alike by material. */
const TINT = {
  /** Untouched fleet colour — the main body panel. */
  body: [1, 1, 1] as Vec3,
  /** Slightly lifted, for a panel that should separate from the body beside it. */
  bodyLight: [1.12, 1.12, 1.12] as Vec3,
  /** Pulled down, for a panel that should recede. */
  bodyDark: [0.82, 0.82, 0.84] as Vec3,
  /** Glass — dark and marginally cool. */
  glass: [0.24, 0.26, 0.32] as Vec3,
  /** Tyres — darker still. */
  wheel: [0.14, 0.15, 0.18] as Vec3,
} as const;

/**
 * Append one part's 5 quads (20 vertices, 30 indices) to the buffers.
 *
 * The bottom face is deliberately omitted: it is never visible from a camera
 * above the ground plane, and at `z = 0` it would be coplanar with the road
 * `PathLayer` and z-fight with it.
 *
 * Winding is not hand-authored. Each quad's normal comes from a cross product
 * and is then compared against the direction from the box centre to the face
 * centre; if it points inwards, both the normal and the vertex order are
 * flipped. Getting a face's winding wrong is otherwise invisible until someone
 * enables back-face culling, at which point the vehicle disappears.
 */
function pushPart(
  part: Part,
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[]
): void {
  const { cx, cy, z, sx, sy, sz, insetX = 0, insetY = 0, tint } = part;

  const hx = sx / 2;
  const hy = sy / 2;
  // A taper may not cross the centreline, or the top face turns inside out.
  const tx = Math.max(hx - insetX, 0);
  const ty = Math.max(hy - insetY, 0);
  const z0 = z;
  const z1 = z + sz;

  // Bottom ring (b) and top ring (t), both counter-clockwise seen from above.
  const b0: Vec3 = [cx - hx, cy - hy, z0];
  const b1: Vec3 = [cx + hx, cy - hy, z0];
  const b2: Vec3 = [cx + hx, cy + hy, z0];
  const b3: Vec3 = [cx - hx, cy + hy, z0];
  const t0: Vec3 = [cx - tx, cy - ty, z1];
  const t1: Vec3 = [cx + tx, cy - ty, z1];
  const t2: Vec3 = [cx + tx, cy + ty, z1];
  const t3: Vec3 = [cx - tx, cy + ty, z1];

  const centre: Vec3 = [cx, cy, (z0 + z1) / 2];
  const quads: [Vec3, Vec3, Vec3, Vec3][] = [
    [t0, t1, t2, t3], // top
    [b3, b2, t2, t3], // front (+y)
    [b1, b0, t0, t1], // back (-y)
    [b2, b1, t1, t2], // starboard (+x)
    [b0, b3, t3, t0], // port (-x)
  ];

  for (const quad of quads) {
    const [p0, p1, , p3] = quad;
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const vx = p3[0] - p0[0];
    const vy = p3[1] - p0[1];
    const vz = p3[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;

    // Face centre minus box centre — the direction the normal must agree with.
    const fx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4 - centre[0];
    const fy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4 - centre[1];
    const fz = (quad[0][2] + quad[1][2] + quad[2][2] + quad[3][2]) / 4 - centre[2];
    const outward = nx * fx + ny * fy + nz * fz >= 0;
    if (!outward) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
      quad.reverse();
    }

    const base = positions.length / 3;
    for (const p of quad) {
      positions.push(p[0], p[1], p[2]);
      normals.push(nx, ny, nz);
      colors.push(tint[0], tint[1], tint[2]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

/** Assemble a part list into the typed arrays the layer uploads. */
export function buildMesh(parts: Part[]): VehicleMesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    pushPart(part, positions, normals, colors, indices);
  }
  return {
    attributes: {
      POSITION: { value: new Float32Array(positions), size: 3 },
      NORMAL: { value: new Float32Array(normals), size: 3 },
      COLOR_0: { value: new Float32Array(colors), size: 3 },
    },
    indices: { value: new Uint16Array(indices), size: 1 },
  };
}

/** Four wheels at the corners of a wheelbase. */
function wheels(
  halfTrack: number,
  frontAxle: number,
  rearAxle: number,
  w: number,
  r: number
): Part[] {
  const spec = (cx: number, cy: number): Part => ({
    cx,
    cy,
    z: 0.02,
    sx: w,
    sy: r * 2,
    sz: r * 2,
    tint: TINT.wheel,
  });
  return [
    spec(-halfTrack, frontAxle),
    spec(halfTrack, frontAxle),
    spec(-halfTrack, rearAxle),
    spec(halfTrack, rearAxle),
  ];
}

/**
 * Overall length of the `car` model. Everything else is sized against this:
 * `VehiclesLayer` scales the whole set so a car covers the same number of
 * screen pixels its sprite used to, which keeps the 2D and 3D views swapping
 * without a jump in apparent size.
 */
export const MESH_REFERENCE_LENGTH_M = 4.4;

const CAR: Part[] = [
  { cx: 0, cy: 0, z: 0.34, sx: 1.8, sy: 4.4, sz: 0.56, insetY: 0.15, tint: TINT.body },
  {
    cx: 0,
    cy: -0.15,
    z: 0.9,
    sx: 1.62,
    sy: 2.1,
    sz: 0.5,
    insetX: 0.22,
    insetY: 0.34,
    tint: TINT.glass,
  },
  ...wheels(0.86, 1.35, -1.35, 0.3, 0.32),
];

const TRUCK: Part[] = [
  // Cab, forward.
  { cx: 0, cy: 2.0, z: 0.62, sx: 2.3, sy: 2.2, sz: 1.9, insetX: 0.1, insetY: 0.4, tint: TINT.body },
  // Windscreen band across the cab's nose.
  { cx: 0, cy: 1.16, z: 1.62, sx: 2.1, sy: 0.32, sz: 0.68, tint: TINT.glass },
  // Cargo body, taller than the cab and set back.
  { cx: 0, cy: -1.5, z: 0.72, sx: 2.44, sy: 4.0, sz: 2.2, tint: TINT.bodyLight },
  ...wheels(1.12, 2.0, -2.5, 0.34, 0.5),
];

const BUS: Part[] = [
  { cx: 0, cy: 0, z: 0.5, sx: 2.5, sy: 8.0, sz: 2.3, insetX: 0.12, insetY: 0.22, tint: TINT.body },
  // Window band, a touch proud of the body so the two faces cannot z-fight.
  { cx: 0, cy: -0.2, z: 1.5, sx: 2.54, sy: 6.6, sz: 0.82, tint: TINT.glass },
  ...wheels(1.12, 2.8, -2.6, 0.34, 0.5),
];

const MOTORCYCLE: Part[] = [
  { cx: 0, cy: -0.05, z: 0.5, sx: 0.46, sy: 1.8, sz: 0.36, insetY: 0.25, tint: TINT.body },
  // Rider — the block that makes a motorcycle read as one at a glance.
  {
    cx: 0,
    cy: -0.1,
    z: 0.84,
    sx: 0.58,
    sy: 0.66,
    sz: 0.76,
    insetX: 0.12,
    insetY: 0.12,
    tint: TINT.bodyDark,
  },
  { cx: 0, cy: 0.62, z: 1.02, sx: 0.88, sy: 0.14, sz: 0.13, tint: TINT.wheel },
  { cx: 0, cy: 0.92, z: 0.02, sx: 0.22, sy: 0.64, sz: 0.64, tint: TINT.wheel },
  { cx: 0, cy: -0.92, z: 0.02, sx: 0.22, sy: 0.64, sz: 0.64, tint: TINT.wheel },
];

const AMBULANCE: Part[] = [
  // Cab, lower and tapered.
  {
    cx: 0,
    cy: 1.75,
    z: 0.5,
    sx: 2.05,
    sy: 2.1,
    sz: 1.3,
    insetX: 0.14,
    insetY: 0.38,
    tint: TINT.body,
  },
  { cx: 0, cy: 0.82, z: 1.2, sx: 1.88, sy: 0.3, sz: 0.56, tint: TINT.glass },
  // Patient compartment — the square box that separates it from a van.
  { cx: 0, cy: -1.2, z: 0.5, sx: 2.2, sy: 3.7, sz: 2.0, tint: TINT.bodyLight },
  // Light bar.
  { cx: 0, cy: 1.75, z: 1.8, sx: 1.5, sy: 0.46, sz: 0.2, tint: TINT.bodyLight },
  ...wheels(1.0, 1.75, -1.85, 0.3, 0.42),
];

/**
 * One mesh per vehicle type. Built eagerly: the whole set is a few thousand
 * floats, and building it lazily would only move the cost to the first frame
 * a given type appears on, which is exactly the frame that can least afford it.
 */
export const VEHICLE_MESHES: Record<string, VehicleMesh> = {
  car: buildMesh(CAR),
  truck: buildMesh(TRUCK),
  bus: buildMesh(BUS),
  motorcycle: buildMesh(MOTORCYCLE),
  ambulance: buildMesh(AMBULANCE),
};

/** The types that have their own mesh, in a stable order for layer ids. */
export const MESH_VEHICLE_TYPES = Object.keys(VEHICLE_MESHES);

/** Unknown/missing types fall back to the car, as the sprite atlas does. */
export const FALLBACK_MESH_TYPE = "car";

export function meshTypeFor(vehicleType: string | undefined): string {
  return vehicleType && vehicleType in VEHICLE_MESHES ? vehicleType : FALLBACK_MESH_TYPE;
}
