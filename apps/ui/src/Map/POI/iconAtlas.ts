/**
 * POI & Speed-limit icon atlas — renders all icons once to an offscreen
 * canvas so deck.gl's IconLayer can instance them on the GPU.
 *
 * POI icons are one disc per semantic group (see ./categories), each carrying a
 * glyph replayed onto the canvas from the vendored geometry in ./glyphs. The
 * glyph is drawn with Path2D/ctx calls rather than an `<img>` fed an SVG data
 * URL: that would decode asynchronously (the atlas is built synchronously at
 * module load) and loaders.gl rejects SVG blobs outright, so an SVG-sourced
 * icon silently never appears. Same reasoning as Direction.tsx's chevron and
 * the vehicle atlas.
 */

import { resolveMapColor } from "@/lib/mapColor";
import { GROUP_META, POI_GROUPS } from "./categories";
import { POI_GLYPHS, type IconNode } from "./glyphs";

// Cell size includes an internal margin (PAD) so each marker's drop shadow and
// white halo ring stay within their own atlas cell and don't bleed into the neighbour.
const ICON_SIZE = 48;
const ICON_PAD = 5;

/** lucide's own coordinate system: every icon is authored in a 24x24 box. */
const GLYPH_VIEWBOX = 24;
/** Fraction of the disc's diameter the glyph fills. */
const GLYPH_FILL = 0.58;
/**
 * Glyph stroke width in viewBox units. A deliberate bump over lucide's default
 * of 2: these are drawn at roughly 22px on a coloured disc, and the thinner
 * default reads as grey mush against the fill at that size.
 */
const GLYPH_STROKE = 2.25;

type IconMappingEntry = {
  x: number;
  y: number;
  width: number;
  height: number;
  mask: boolean;
};

// ─── Helpers ────────────────────────────────────────────────────────

/** `[r,g,b,a]` from a token back to a canvas-consumable CSS colour. */
function rgbString(token: string): string {
  const [r, g, b] = resolveMapColor(token);
  return `rgb(${r}, ${g}, ${b})`;
}

/** The coloured disc every POI marker sits on: fill, soft shadow, white ring. */
function renderDisc(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  bgColor: string
) {
  // Filled circle with a soft drop shadow so the marker separates from the map.
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.restore();

  // Crisp white halo ring (no shadow) — the main contrast boost.
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function num(attrs: Record<string, string>, name: string): number {
  const value = Number(attrs[name]);
  return Number.isFinite(value) ? value : 0;
}

/** `"1,2 3,4"` / `"1 2 3 4"` → `[[1,2],[3,4]]`. */
function parsePoints(raw: string | undefined): [number, number][] {
  const nums = (raw ?? "")
    .split(/[\s,]+/)
    .map(Number)
    .filter(Number.isFinite);
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) points.push([nums[i], nums[i + 1]]);
  return points;
}

/**
 * The SVG element tags the glyph rasteriser understands. Exported so the glyph
 * data can be tested against it: a lucide refresh that introduces an `ellipse`
 * would otherwise drop that stroke silently.
 */
export const SUPPORTED_GLYPH_TAGS = [
  "path",
  "circle",
  "rect",
  "line",
  "polyline",
  "polygon",
] as const;

/** Replay one glyph element as canvas strokes. */
function strokeElement(ctx: CanvasRenderingContext2D, tag: string, attrs: Record<string, string>) {
  switch (tag) {
    case "path": {
      if (attrs.d) ctx.stroke(new Path2D(attrs.d));
      return;
    }
    case "circle": {
      ctx.beginPath();
      ctx.arc(num(attrs, "cx"), num(attrs, "cy"), num(attrs, "r"), 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    case "rect": {
      const x = num(attrs, "x");
      const y = num(attrs, "y");
      const w = num(attrs, "width");
      const h = num(attrs, "height");
      // lucide draws most of its boxes with rounded corners. SVG lets `rx` and
      // `ry` stand in for each other when only one is given, and a plain
      // `ctx.rect` would square off a corner the icon has rounded.
      const rx = attrs.rx !== undefined ? num(attrs, "rx") : attrs.ry ? num(attrs, "ry") : 0;
      const ry = attrs.ry !== undefined ? num(attrs, "ry") : rx;
      ctx.beginPath();
      if (rx > 0 || ry > 0) {
        ctx.roundRect(x, y, w, h, [{ x: rx, y: ry }]);
      } else {
        ctx.rect(x, y, w, h);
      }
      ctx.stroke();
      return;
    }
    case "line": {
      ctx.beginPath();
      ctx.moveTo(num(attrs, "x1"), num(attrs, "y1"));
      ctx.lineTo(num(attrs, "x2"), num(attrs, "y2"));
      ctx.stroke();
      return;
    }
    case "polyline":
    case "polygon": {
      const points = parsePoints(attrs.points);
      if (points.length === 0) return;
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
      if (tag === "polygon") ctx.closePath();
      ctx.stroke();
      return;
    }
    default:
      return;
  }
}

/** Draw a vendored glyph centred on the disc, scaled to fill it. */
function renderGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: IconNode,
  cx: number,
  cy: number,
  r: number,
  iconColor: string
) {
  const size = r * 2 * GLYPH_FILL;
  const scale = size / GLYPH_VIEWBOX;

  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(scale, scale);
  ctx.strokeStyle = iconColor;
  ctx.lineWidth = GLYPH_STROKE;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [tag, attrs] of glyph) strokeElement(ctx, tag, attrs);
  ctx.restore();
}

// ─── POI atlas ──────────────────────────────────────────────────────

/** An atlas the GPU can still bind when there is no 2D context (jsdom). */
function emptyPOIAtlas() {
  const iconMapping: Record<string, IconMappingEntry> = {};
  for (const group of POI_GROUPS) {
    iconMapping[group] = { x: 0, y: 0, width: 0, height: 0, mask: false };
  }
  return { iconAtlas: "", iconMapping };
}

export function createPOIIconAtlas(): {
  iconAtlas: string;
  iconMapping: Record<string, IconMappingEntry>;
} {
  if (typeof document === "undefined") return emptyPOIAtlas();

  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE * POI_GROUPS.length;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  // jsdom has no 2D context, so the module still has to import cleanly for the
  // layer tests that mount POIs.
  if (!ctx) return emptyPOIAtlas();

  const iconMapping: Record<string, IconMappingEntry> = {};

  POI_GROUPS.forEach((group, i) => {
    const x = i * ICON_SIZE;
    const cx = x + ICON_SIZE / 2;
    const cy = ICON_SIZE / 2;
    const r = ICON_SIZE / 2 - ICON_PAD;
    renderDisc(ctx, cx, cy, r, rgbString(GROUP_META[group].token));
    renderGlyph(ctx, POI_GLYPHS[group], cx, cy, r, "rgba(255,255,255,0.98)");
    iconMapping[group] = { x, y: 0, width: ICON_SIZE, height: ICON_SIZE, mask: false };
  });

  return { iconAtlas: canvas.toDataURL(), iconMapping };
}

// ─── Speed-limit atlas ──────────────────────────────────────────────

const COMMON_SPEEDS = [10, 20, 30, 40, 50, 60, 80, 100, 120];
const SPEED_SIGN_SIZE = 44;

function renderSpeedSign(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  speed: number
) {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;

  // White circle fill
  ctx.beginPath();
  ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = "white";
  ctx.fill();

  // Red border
  const borderWidth = size * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - borderWidth / 2 - 1, 0, Math.PI * 2);
  ctx.strokeStyle = "#cc0000";
  ctx.lineWidth = borderWidth;
  ctx.stroke();

  // Speed number
  ctx.fillStyle = "#111";
  ctx.font = `bold ${speed >= 100 ? Math.round(size * 0.32) : Math.round(size * 0.4)}px Arial, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(speed), cx, cy);
}

export function createSpeedLimitIconAtlas(): {
  iconAtlas: string;
  iconMapping: Record<string, IconMappingEntry>;
} {
  const iconMapping: Record<string, IconMappingEntry> = {};
  const empty = () => {
    for (const speed of COMMON_SPEEDS) {
      iconMapping[`speed_${speed}`] = { x: 0, y: 0, width: 0, height: 0, mask: false };
    }
    return { iconAtlas: "", iconMapping };
  };

  if (typeof document === "undefined") return empty();

  const canvas = document.createElement("canvas");
  canvas.width = SPEED_SIGN_SIZE * COMMON_SPEEDS.length;
  canvas.height = SPEED_SIGN_SIZE;
  const ctx = canvas.getContext("2d");
  // jsdom has no 2D context — the module still has to import cleanly for tests.
  if (!ctx) return empty();

  COMMON_SPEEDS.forEach((speed, i) => {
    const x = i * SPEED_SIGN_SIZE;
    renderSpeedSign(ctx, x, 0, SPEED_SIGN_SIZE, speed);
    iconMapping[`speed_${speed}`] = {
      x,
      y: 0,
      width: SPEED_SIGN_SIZE,
      height: SPEED_SIGN_SIZE,
      mask: false,
    };
  });

  return { iconAtlas: canvas.toDataURL(), iconMapping };
}

/** Map a numeric speed to the closest pre-rendered atlas key. */
export function speedToIconKey(speed: number): string {
  let best = COMMON_SPEEDS[0];
  let bestDist = Math.abs(speed - best);
  for (let i = 1; i < COMMON_SPEEDS.length; i++) {
    const d = Math.abs(speed - COMMON_SPEEDS[i]);
    if (d < bestDist) {
      best = COMMON_SPEEDS[i];
      bestDist = d;
    }
  }
  return `speed_${best}`;
}
