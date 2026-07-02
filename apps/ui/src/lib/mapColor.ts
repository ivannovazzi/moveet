/**
 * Resolve a CSS color — including `var(--token)` references and modern
 * syntaxes like oklch() — to a concrete [r, g, b, a] byte array for deck.gl
 * layer props, which only accept numeric color arrays (see tokens.css).
 *
 * Uses an offscreen 1x1 canvas so the browser does the color-space
 * conversion, avoiding hand-rolled oklch math and staying correct for any
 * valid CSS color string regardless of how getComputedStyle serializes it.
 *
 * Results are cached per (color, alpha) pair. Safe to call from useMemo, not
 * from a per-frame hot loop — see VehiclesLayer's own resolveCSSColor for
 * that case (it resolves to a color *string* for the icon atlas, not bytes).
 */
const cache = new Map<string, [number, number, number, number]>();
let sharedCtx: CanvasRenderingContext2D | null | undefined;

function getSharedCtx(): CanvasRenderingContext2D | null {
  if (sharedCtx !== undefined) return sharedCtx;
  if (typeof document === "undefined") {
    sharedCtx = null;
    return sharedCtx;
  }
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  sharedCtx = canvas.getContext("2d", { willReadFrequently: true });
  return sharedCtx;
}

/** Fallback used when the color can't be resolved (e.g. jsdom in tests). */
const FALLBACK: [number, number, number, number] = [128, 128, 128, 255];

export function resolveMapColor(color: string, alpha = 255): [number, number, number, number] {
  const key = `${color}:${alpha}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let cssColor = color;
  if (color.startsWith("var(")) {
    const match = color.match(/^var\(([^)]+)\)$/);
    const varName = match?.[1];
    cssColor = varName
      ? getComputedStyle(document.documentElement).getPropertyValue(varName).trim() || color
      : color;
  }

  const ctx = getSharedCtx();
  let rgba = FALLBACK;
  if (ctx) {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = cssColor;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    rgba = [r, g, b, alpha];
  }
  cache.set(key, rgba);
  return rgba;
}
