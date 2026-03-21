/**
 * POI & Speed-limit icon atlas — renders all icons once to an offscreen
 * canvas so deck.gl's IconLayer can instance them on the GPU.
 */

const ICON_SIZE = 44;

// ─── POI type → background colour ──────────────────────────────────
const POI_COLORS: Record<string, string> = {
  shop: "#e74c3c",
  leisure: "#2ecc71",
  craft: "#e67e22",
  office: "#3498db",
  bus_stop: "#95a5a6",
  unknown: "#7f8c8d",
};

// ─── SVG path data extracted from Icons.tsx ─────────────────────────
// Each entry: [pathData, viewBox "minX minY width height"]
// Where multiple <path> elements exist they are concatenated with spaces
// (Path2D handles disjoint sub-paths fine).
const POI_PATHS: Record<string, { d: string; viewBox: string }> = {
  shop: {
    d: "M3 1L0 4V5C0 5 2 6 4 6C6 6 8 5 8 5C8 5 10 6 12 6C14 6 16 5 16 5V4L13 1H3Z M1 15V7.5187C1.81671 7.76457 2.88168 8 4 8C5.3025 8 6.53263 7.68064 7.38246 7.39737C7.60924 7.32177 7.81664 7.24612 8 7.17526C8.18337 7.24612 8.39076 7.32177 8.61754 7.39737C9.46737 7.68064 10.6975 8 12 8C13.1183 8 14.1833 7.76457 15 7.5187V15H7V10H4V15H1ZM12 10H10V13H12V10Z",
    viewBox: "0 0 16 16",
  },
  leisure: {
    d: "M508.011,371.606L405.334,227.841V42.667c0-11.776-9.536-21.333-21.333-21.333h-256c-11.797,0-21.333,9.557-21.333,21.333 v9.259l-96.32,57.792c-5.099,3.051-8.683,8.107-9.899,13.931c-1.216,5.845,0.064,11.904,3.541,16.747l102.677,143.765v185.173 c0,11.776,9.536,21.333,21.333,21.333h256c11.797,0,21.333-9.557,21.333-21.333v-9.259l96.32-57.771 c5.099-3.072,8.683-8.128,9.899-13.952C512.769,382.507,511.489,376.449,508.011,371.606z M106.667,210.774l-54.549-76.373 l54.549-32.725V210.774z M320.001,170.667c11.776,0,21.333,9.557,21.333,21.333s-9.557,21.333-21.333,21.333 s-21.333-9.557-21.333-21.333S308.225,170.667,320.001,170.667z M256.001,128.001c11.776,0,21.333,9.557,21.333,21.333 s-9.557,21.333-21.333,21.333c-11.776,0-21.333-9.557-21.333-21.333S244.225,128.001,256.001,128.001z M192.001,85.334 c11.776,0,21.333,9.557,21.333,21.333s-9.557,21.333-21.333,21.333s-21.333-9.557-21.333-21.333S180.225,85.334,192.001,85.334z M192.001,426.667c-11.776,0-21.333-9.557-21.333-21.333s9.557-21.333,21.333-21.333s21.333,9.557,21.333,21.333 S203.777,426.667,192.001,426.667z M192.001,341.334c-11.776,0-21.333-9.557-21.333-21.333s9.557-21.333,21.333-21.333 s21.333,9.557,21.333,21.333S203.777,341.334,192.001,341.334z M320.001,426.667c-11.776,0-21.333-9.557-21.333-21.333 s9.557-21.333,21.333-21.333s21.333,9.557,21.333,21.333S331.777,426.667,320.001,426.667z M320.001,341.334 c-11.776,0-21.333-9.557-21.333-21.333s9.557-21.333,21.333-21.333s21.333,9.557,21.333,21.333S331.777,341.334,320.001,341.334z M405.334,410.326V301.249l54.549,76.352L405.334,410.326z",
    viewBox: "0 0 512 512",
  },
  craft: {
    d: "M92.358,62.188c-6.326-6.28-16.271-6.722-23.109-1.327l-6.527-6.431l21.753-21.638c7.641-7.6,7.68-19.953,0.087-27.601 l-35.73,35.557L13.743,6.187c-3.641,3.667-5.672,8.634-5.645,13.801s2.11,10.112,5.79,13.741l21.09,20.807l-6.699,6.666 c-6.837-5.396-16.784-4.953-23.109,1.328c-6.837,6.784-6.909,17.836-0.123,24.672c6.787,6.836,17.837,6.844,24.672,0.057 l19.136-19.035l18.954,18.695c6.835,6.787,17.886,6.781,24.673-0.057C99.269,80.025,99.195,68.976,92.358,62.188z M22.122,79.604 c-2.578,2.558-6.754,2.542-9.313-0.034c-2.558-2.576-2.542-6.755,0.035-9.312c2.577-2.557,6.754-2.543,9.312,0.033 C24.714,72.869,24.699,77.045,22.122,79.604z M48.993,61.193c-3.656,0-6.621-2.964-6.621-6.621c0-3.656,2.964-6.621,6.621-6.621 s6.621,2.964,6.621,6.621C55.614,58.229,52.649,61.193,48.993,61.193z M84.72,79.231c-2.56,2.576-6.735,2.593-9.313,0.033 c-2.576-2.56-2.592-6.735-0.033-9.313c2.559-2.576,6.735-2.59,9.312-0.033C87.262,72.478,87.277,76.656,84.72,79.231z",
    viewBox: "0 0 97.529 97.529",
  },
  office: {
    d: "M5,21H19a2.006,2.006,0,0,0,2-2V9a2.006,2.006,0,0,0-2-2H17V5a2,2,0,0,0-2-2H9A2,2,0,0,0,7,5V7H5A2.006,2.006,0,0,0,3,9V19A2.006,2.006,0,0,0,5,21ZM16,9h2V19H16ZM9,5.5A.5.5,0,0,1,9.5,5h5a.5.5,0,0,1,.5.5V7H9ZM6,9H8V19H6Z",
    viewBox: "0 0 24 24",
  },
  bus_stop: {
    d: "M 3,0 C 2,0 1,1 1,2 l 0,10.484375 1,0 C 2,13 2,14 3,14 4,14 4,13 4,12.484375 l 6,0.03125 C 10,13 10,14 11,14 c 1,0 1,-1 1,-1.484375 l 1,0 L 13,2 C 13,1 12,0 11,0 z m 1,1 6,0 0,1 -6,0 z M 3,2.96875 11,3 11,7 3,6.96875 z M 4,9 C 4.552285,9 5,9.447715 5,10 5,10.552284 4.552285,11 4,11 3.447715,11 3,10.552284 3,10 3,9.447715 3.447715,9 4,9 z m 6,0 c 0.552285,0 1,0.447715 1,1 0,0.552284 -0.447715,1 -1,1 C 9.447715,11 9,10.552284 9,10 9,9.447715 9.447715,9 10,9 z",
    viewBox: "0 0 14 14",
  },
  unknown: {
    d: "M29.4163,14.5906,17.41,2.5842a1.9937,1.9937,0,0,0-2.8191,0L2.5837,14.5906a1.994,1.994,0,0,0,0,2.8193L14.5906,29.4163a1.9937,1.9937,0,0,0,2.8191,0L29.4163,17.41A1.994,1.994,0,0,0,29.4163,14.5906ZM16,24a1.5,1.5,0,1,1,1.5-1.5A1.5,1.5,0,0,1,16,24Zm1.125-6.7519v1.8769h-2.25V15H17a1.875,1.875,0,0,0,0-3.75H15a1.8771,1.8771,0,0,0-1.875,1.875v.5h-2.25v-.5A4.13,4.13,0,0,1,15,9h2a4.125,4.125,0,0,1,.125,8.2481Z",
    viewBox: "0 0 32 32",
  },
};

// ─── Helpers ────────────────────────────────────────────────────────

function renderSVGToCanvas(
  ctx: CanvasRenderingContext2D,
  svgPathData: string,
  x: number,
  y: number,
  size: number,
  bgColor: string,
  iconColor: string,
  viewBox: string
) {
  // Draw background circle
  const r = size / 2;
  ctx.beginPath();
  ctx.arc(x + r, y + r, r - 1, 0, Math.PI * 2);
  ctx.fillStyle = bgColor;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 1;
  ctx.stroke();

  // Draw SVG icon using Path2D
  const [, , vw, vh] = viewBox.split(" ").map(Number);
  const iconSize = size * 0.6;
  const scale = iconSize / Math.max(vw, vh);
  const offsetX = x + (size - vw * scale) / 2;
  const offsetY = y + (size - vh * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  const path = new Path2D(svgPathData);
  ctx.fillStyle = iconColor;
  ctx.fill(path);
  ctx.restore();
}

type IconMappingEntry = { x: number; y: number; width: number; height: number; mask: boolean };

// ─── POI atlas ──────────────────────────────────────────────────────

export function createPOIIconAtlas(): {
  iconAtlas: string;
  iconMapping: Record<string, IconMappingEntry>;
} {
  const types = Object.keys(POI_PATHS);
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE * types.length;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d")!;

  const iconMapping: Record<string, IconMappingEntry> = {};

  types.forEach((type, i) => {
    const x = i * ICON_SIZE;
    const bgColor = POI_COLORS[type] ?? POI_COLORS.unknown;
    // Bus stops use dark icon on light bg; others use white icon
    const iconColor = type === "bus_stop" ? "rgba(51,51,51,0.87)" : "rgba(255,255,255,0.87)";
    const { d, viewBox } = POI_PATHS[type];
    renderSVGToCanvas(ctx, d, x, 0, ICON_SIZE, bgColor, iconColor, viewBox);
    iconMapping[type] = { x, y: 0, width: ICON_SIZE, height: ICON_SIZE, mask: false };
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
  const canvas = document.createElement("canvas");
  canvas.width = SPEED_SIGN_SIZE * COMMON_SPEEDS.length;
  canvas.height = SPEED_SIGN_SIZE;
  const ctx = canvas.getContext("2d")!;

  const iconMapping: Record<string, IconMappingEntry> = {};

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
