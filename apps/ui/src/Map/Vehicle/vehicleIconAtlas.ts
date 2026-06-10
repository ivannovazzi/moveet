/**
 * Vehicle icon atlas — renders detailed top-down vehicle sprites (car, truck,
 * bus, motorcycle, ambulance) to an offscreen canvas so deck.gl's IconLayer
 * can instance them on the GPU, replacing the old flat polygon shapes.
 *
 * Unlike the static POI atlas, vehicle sprites are tinted by fleet color, so
 * the atlas is built dynamically: each (type, color) combination gets its own
 * cell, added lazily as combinations appear in the data stream.
 */

/** Atlas cell size in device pixels. Sprites are drawn at 128px and scaled
 * down by deck.gl, which keeps edges crisp at typical 16–40px display sizes. */
const CELL = 128;
/** Max cells per atlas row before wrapping to a new row. */
const COLS = 8;

export type IconMappingEntry = {
  x: number;
  y: number;
  width: number;
  height: number;
  mask: boolean;
};

// ─── Color helpers ──────────────────────────────────────────────────

/** Parse a hex or rgb()/rgba() color string to an [r, g, b] triple. */
export function parseColor(color: string): [number, number, number] {
  const c = color.trim();
  if (c.startsWith("#")) {
    const h = c.slice(1);
    const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h;
    const n = parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const nums = c.match(/[\d.]+/g);
  if (nums && nums.length >= 3) {
    return [Math.round(+nums[0]), Math.round(+nums[1]), Math.round(+nums[2])];
  }
  return [220, 220, 220];
}

/**
 * Shade a color: amt in [-1, 1] mixes toward black (negative) or white
 * (positive). Returns an rgb() string usable as a canvas fillStyle.
 */
export function shade(color: string, amt: number): string {
  const [r, g, b] = parseColor(color);
  const target = amt < 0 ? 0 : 255;
  const t = Math.abs(amt);
  const mix = (ch: number) => Math.round(ch + (target - ch) * t);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// ─── Sprite drawing ─────────────────────────────────────────────────
// All sprites are drawn pointing "up" (north) in a CELL×CELL cell whose
// origin is passed as (ox, oy). Proportions encode relative vehicle size:
// a bus fills more of the cell than a car, so a single IconLayer getSize
// still yields type-appropriate on-screen sizes.

const OUTLINE = "rgba(10, 12, 18, 0.65)";
const HALO = "rgba(255, 255, 255, 0.30)";
const GLASS = "rgba(15, 20, 30, 0.82)";
const WHEEL = "#1a1d24";

function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[]
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

/** Stroke a wide translucent halo, then fill + outline the current path. */
function bodyFill(ctx: CanvasRenderingContext2D, color: string) {
  ctx.strokeStyle = HALO;
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2.5;
  ctx.stroke();
}

function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  rr(ctx, x, y, w, h, 4);
  ctx.fillStyle = WHEEL;
  ctx.fill();
}

function drawCar(ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string) {
  // Wheels peek out from under the body
  wheel(ctx, ox + 37, oy + 28, 10, 22);
  wheel(ctx, ox + 81, oy + 28, 10, 22);
  wheel(ctx, ox + 37, oy + 80, 10, 22);
  wheel(ctx, ox + 81, oy + 80, 10, 22);
  // Body
  rr(ctx, ox + 41, oy + 15, 46, 98, [22, 22, 16, 16]);
  bodyFill(ctx, color);
  // Headlights
  ctx.fillStyle = "rgba(255, 250, 215, 0.9)";
  rr(ctx, ox + 47, oy + 17, 12, 5, 2.5);
  ctx.fill();
  rr(ctx, ox + 69, oy + 17, 12, 5, 2.5);
  ctx.fill();
  // Windshield
  ctx.fillStyle = GLASS;
  rr(ctx, ox + 47, oy + 38, 34, 16, 6);
  ctx.fill();
  // Roof (slightly lighter than the body)
  ctx.fillStyle = shade(color, 0.14);
  rr(ctx, ox + 47, oy + 58, 34, 28, 8);
  ctx.fill();
  // Rear window
  ctx.fillStyle = "rgba(15, 20, 30, 0.7)";
  rr(ctx, ox + 49, oy + 90, 30, 11, 5);
  ctx.fill();
}

function drawTruck(ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string) {
  wheel(ctx, ox + 36, oy + 22, 10, 20);
  wheel(ctx, ox + 82, oy + 22, 10, 20);
  wheel(ctx, ox + 34, oy + 82, 10, 20);
  wheel(ctx, ox + 84, oy + 82, 10, 20);
  wheel(ctx, ox + 34, oy + 96, 10, 20);
  wheel(ctx, ox + 84, oy + 96, 10, 20);
  // Cab (fleet color)
  rr(ctx, ox + 40, oy + 12, 48, 32, [14, 14, 5, 5]);
  bodyFill(ctx, color);
  // Cab windshield
  ctx.fillStyle = GLASS;
  rr(ctx, ox + 45, oy + 20, 38, 11, 5);
  ctx.fill();
  // Cargo box — pale tint of the fleet color so the fleet stays identifiable
  rr(ctx, ox + 38, oy + 48, 52, 68, 6);
  bodyFill(ctx, shade(color, 0.62));
  // Container seams
  ctx.strokeStyle = "rgba(10, 12, 18, 0.18)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox + 38, oy + 71);
  ctx.lineTo(ox + 90, oy + 71);
  ctx.moveTo(ox + 38, oy + 94);
  ctx.lineTo(ox + 90, oy + 94);
  ctx.stroke();
}

function drawBus(ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string) {
  wheel(ctx, ox + 36, oy + 20, 10, 22);
  wheel(ctx, ox + 82, oy + 20, 10, 22);
  wheel(ctx, ox + 36, oy + 90, 10, 22);
  wheel(ctx, ox + 82, oy + 90, 10, 22);
  // Body — longest silhouette in the set
  rr(ctx, ox + 40, oy + 8, 48, 112, [16, 16, 12, 12]);
  bodyFill(ctx, color);
  // Windshield
  ctx.fillStyle = GLASS;
  rr(ctx, ox + 45, oy + 13, 38, 12, 5);
  ctx.fill();
  // Roof channel
  ctx.fillStyle = shade(color, 0.16);
  rr(ctx, ox + 48, oy + 32, 32, 74, 10);
  ctx.fill();
  // Roof hatches
  ctx.fillStyle = "rgba(10, 12, 18, 0.16)";
  for (const y of [40, 62, 84]) {
    rr(ctx, ox + 54, oy + y, 20, 12, 3);
    ctx.fill();
  }
  // Rear engine vent
  ctx.fillStyle = "rgba(15, 20, 30, 0.55)";
  rr(ctx, ox + 48, oy + 110, 32, 6, 3);
  ctx.fill();
}

function drawMotorcycle(ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string) {
  // Front and rear wheels
  wheel(ctx, ox + 60, oy + 14, 8, 22);
  wheel(ctx, ox + 59, oy + 94, 10, 22);
  // Handlebar
  ctx.fillStyle = "#2a2f3a";
  rr(ctx, ox + 44, oy + 36, 40, 6, 3);
  ctx.fill();
  // Tank/body
  rr(ctx, ox + 54, oy + 40, 20, 40, 10);
  bodyFill(ctx, color);
  // Rider shoulders + helmet
  ctx.fillStyle = "rgba(28, 33, 44, 0.95)";
  rr(ctx, ox + 50, oy + 64, 28, 20, 10);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ox + 64, oy + 64, 11, 0, Math.PI * 2);
  ctx.fillStyle = shade(color, -0.35);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawAmbulance(ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string) {
  wheel(ctx, ox + 34, oy + 26, 10, 22);
  wheel(ctx, ox + 84, oy + 26, 10, 22);
  wheel(ctx, ox + 34, oy + 86, 10, 22);
  wheel(ctx, ox + 84, oy + 86, 10, 22);
  // Van body
  rr(ctx, ox + 38, oy + 12, 52, 104, [18, 18, 10, 10]);
  bodyFill(ctx, color);
  // Light bar at the front
  ctx.fillStyle = "#3b82f6";
  rr(ctx, ox + 46, oy + 15, 14, 6, 2);
  ctx.fill();
  ctx.fillStyle = "#ef4444";
  rr(ctx, ox + 68, oy + 15, 14, 6, 2);
  ctx.fill();
  // Windshield
  ctx.fillStyle = GLASS;
  rr(ctx, ox + 44, oy + 26, 40, 13, 5);
  ctx.fill();
  // White roof with red cross
  ctx.fillStyle = "#f1f5f9";
  rr(ctx, ox + 44, oy + 44, 40, 64, 8);
  ctx.fill();
  ctx.fillStyle = "#ef4444";
  rr(ctx, ox + 59, oy + 59, 10, 34, 2);
  ctx.fill();
  rr(ctx, ox + 47, oy + 71, 34, 10, 2);
  ctx.fill();
}

type SpriteDrawFn = (ctx: CanvasRenderingContext2D, ox: number, oy: number, color: string) => void;

const SPRITES: Record<string, SpriteDrawFn> = {
  car: drawCar,
  truck: drawTruck,
  motorcycle: drawMotorcycle,
  ambulance: drawAmbulance,
  bus: drawBus,
};

// ─── Dynamic atlas ──────────────────────────────────────────────────

export interface VehicleAtlas {
  iconAtlas: string;
  iconMapping: Record<string, IconMappingEntry>;
}

/**
 * Lazily growing (type, color) → sprite atlas. register() is called from the
 * render loop for every visible vehicle; it is O(1) for known combinations.
 * When new combinations appear, the caller checks isDirty and rebuilds.
 */
export class VehicleIconAtlasManager {
  private combos = new Map<string, { type: string; color: string }>();
  private dirty = false;

  /** Register a combination and return its atlas key. */
  register(type: string, color: string): string {
    const spriteType = type in SPRITES ? type : "car";
    const key = `${spriteType}|${color}`;
    if (!this.combos.has(key)) {
      this.combos.set(key, { type: spriteType, color });
      this.dirty = true;
    }
    return key;
  }

  get isDirty(): boolean {
    return this.dirty;
  }

  /** Render all registered combinations to a fresh atlas. Clears the dirty flag. */
  build(): VehicleAtlas {
    this.dirty = false;
    const keys = [...this.combos.keys()];
    const cols = Math.min(Math.max(keys.length, 1), COLS);
    const rows = Math.max(Math.ceil(keys.length / COLS), 1);

    const canvas = document.createElement("canvas");
    canvas.width = cols * CELL;
    canvas.height = rows * CELL;
    const ctx = canvas.getContext("2d");

    const iconMapping: Record<string, IconMappingEntry> = {};
    keys.forEach((key, i) => {
      const x = (i % COLS) * CELL;
      const y = Math.floor(i / COLS) * CELL;
      iconMapping[key] = { x, y, width: CELL, height: CELL, mask: false };
      if (ctx) {
        const { type, color } = this.combos.get(key)!;
        SPRITES[type](ctx, x, y, color);
      }
    });

    // ctx is null in environments without canvas 2D (jsdom tests)
    return { iconAtlas: ctx ? canvas.toDataURL() : "", iconMapping };
  }
}
