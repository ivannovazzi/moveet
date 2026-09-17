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
  /** Per-side inset of the top face in x, metres — how much the box narrows. */
  insetX?: number;
  /**
   * Inset of the top face along y, metres. `insetY` applies to both ends;
   * `insetFront` / `insetBack` override it for one end.
   *
   * An asymmetric taper is what turns a box into a vehicle: a large
   * `insetFront` on a cabin is a raked windscreen, a smaller `insetBack` is the
   * gentler slope of a rear window, and a nose that tapers more than the tail
   * reads as a bonnet.
   */
  insetY?: number;
  insetFront?: number;
  insetBack?: number;
  /** Multiplier on the vehicle's instance colour. See the module comment. */
  tint: [number, number, number];
}

type Vec3 = [number, number, number];

/**
 * Shading multipliers shared across the models, so parts read alike by material.
 *
 * These are deliberately shallow. An earlier pass used near-black glass (0.24)
 * and tyres (0.14), which looked right in a side elevation and wrong on a map:
 * the view is mostly top-down, the cabin covers most of the roof, and a vehicle
 * read as a dark blob with a coloured rim instead of a coloured vehicle. The
 * range here stays inside roughly 0.55..1.2 so the fleet colour survives on
 * every face, and separation comes from the lighting rather than from pigment.
 */
const TINT = {
  /** Untouched fleet colour — the main body panel. */
  body: [1, 1, 1] as Vec3,
  /** Lifted, for a panel that should separate from the body beside it. */
  bodyLight: [1.18, 1.18, 1.18] as Vec3,
  /** The cabin/roof: a shade down, marginally cool, still clearly the fleet colour. */
  roof: [0.74, 0.76, 0.82] as Vec3,
  /** Tyres. Dark enough to read as rubber, light enough not to be a hole. */
  tyre: [0.5, 0.51, 0.55] as Vec3,
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
  const insetFront = part.insetFront ?? insetY;
  const insetBack = part.insetBack ?? insetY;

  const hx = sx / 2;
  const hy = sy / 2;
  // A taper may not cross the centreline, or the top face turns inside out.
  const tx = Math.max(hx - insetX, 0);
  const tyFront = Math.max(hy - insetFront, 0);
  const tyBack = Math.max(hy - insetBack, 0);
  const z0 = z;
  const z1 = z + sz;

  // Bottom ring (b) and top ring (t), both counter-clockwise seen from above.
  const b0: Vec3 = [cx - hx, cy - hy, z0];
  const b1: Vec3 = [cx + hx, cy - hy, z0];
  const b2: Vec3 = [cx + hx, cy + hy, z0];
  const b3: Vec3 = [cx - hx, cy + hy, z0];
  const t0: Vec3 = [cx - tx, cy - tyBack, z1];
  const t1: Vec3 = [cx + tx, cy - tyBack, z1];
  const t2: Vec3 = [cx + tx, cy + tyFront, z1];
  const t3: Vec3 = [cx - tx, cy + tyFront, z1];

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

/**
 * Four wheels at the corners of a wheelbase.
 *
 * An earlier pass replaced these with a single chassis slab, on the grounds
 * that four boxes read as noise at the small end of the zoom range. They are
 * back because a wheelless body reads as a brick from any angle where the
 * models are legible at all, and because the tyre tint is now light enough
 * (0.5) that four of them no longer drag the whole vehicle dark. They are set
 * slightly proud of the body sides so the arches catch the key light.
 */
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
    z: 0.015,
    sx: w,
    sy: r * 2,
    sz: r * 2,
    tint: TINT.tyre,
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
  // Body. The nose tapers harder than the tail, which is what reads as a bonnet.
  {
    cx: 0,
    cy: 0,
    z: 0.32,
    sx: 1.8,
    sy: 4.4,
    sz: 0.56,
    insetX: 0.06,
    insetFront: 0.38,
    insetBack: 0.2,
    tint: TINT.body,
  },
  // Cabin. The large front inset is the windscreen rake; the smaller back one
  // is the rear window.
  {
    cx: 0,
    cy: -0.22,
    z: 0.86,
    sx: 1.58,
    sy: 2.3,
    sz: 0.52,
    insetX: 0.2,
    insetFront: 0.66,
    insetBack: 0.24,
    tint: TINT.roof,
  },
  ...wheels(0.86, 1.4, -1.4, 0.28, 0.33),
];

const TRUCK: Part[] = [
  // Cab, forward and lower than the load behind it, with a raked screen.
  {
    cx: 0,
    cy: 2.1,
    z: 0.62,
    sx: 2.3,
    sy: 2.0,
    sz: 1.5,
    insetX: 0.08,
    insetFront: 0.5,
    insetBack: 0.08,
    tint: TINT.body,
  },
  // Cargo body — the block that makes it a truck rather than a long car.
  {
    cx: 0,
    cy: -1.5,
    z: 0.7,
    sx: 2.44,
    sy: 4.2,
    sz: 2.2,
    insetX: 0.05,
    insetY: 0.05,
    tint: TINT.bodyLight,
  },
  ...wheels(1.12, 2.1, -2.4, 0.32, 0.48),
];

const BUS: Part[] = [
  {
    cx: 0,
    cy: 0,
    z: 0.5,
    sx: 2.5,
    sy: 8.0,
    sz: 2.15,
    insetX: 0.1,
    insetFront: 0.3,
    insetBack: 0.25,
    tint: TINT.body,
  },
  // Roof cap, inset all round, so the silhouette from above is not one flat slab.
  {
    cx: 0,
    cy: 0,
    z: 2.6,
    sx: 2.24,
    sy: 7.0,
    sz: 0.2,
    insetX: 0.14,
    insetFront: 0.5,
    insetBack: 0.45,
    tint: TINT.roof,
  },
  ...wheels(1.12, 2.9, -2.7, 0.32, 0.48),
];

const MOTORCYCLE: Part[] = [
  // Tank and seat: tapered at both ends, more at the front.
  {
    cx: 0,
    cy: 0,
    z: 0.28,
    sx: 0.4,
    sy: 1.75,
    sz: 0.42,
    insetFront: 0.45,
    insetBack: 0.3,
    tint: TINT.body,
  },
  // Rider — the block that makes a motorcycle read as one at a glance.
  {
    cx: 0,
    cy: -0.12,
    z: 0.68,
    sx: 0.58,
    sy: 0.68,
    sz: 0.78,
    insetX: 0.14,
    insetFront: 0.16,
    insetBack: 0.1,
    tint: TINT.roof,
  },
  { cx: 0, cy: 0.86, z: 0.015, sx: 0.2, sy: 0.62, sz: 0.62, tint: TINT.tyre },
  { cx: 0, cy: -0.86, z: 0.015, sx: 0.2, sy: 0.62, sz: 0.62, tint: TINT.tyre },
];

const AMBULANCE: Part[] = [
  // Cab, lower and raked.
  {
    cx: 0,
    cy: 1.7,
    z: 0.46,
    sx: 2.05,
    sy: 2.0,
    sz: 1.25,
    insetX: 0.12,
    insetFront: 0.55,
    insetBack: 0.08,
    tint: TINT.body,
  },
  // Patient compartment — the square box that separates it from a van.
  { cx: 0, cy: -1.25, z: 0.46, sx: 2.2, sy: 3.6, sz: 1.95, insetX: 0.04, tint: TINT.bodyLight },
  ...wheels(1.0, 1.7, -1.9, 0.28, 0.42),
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
