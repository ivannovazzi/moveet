/**
 * Resolve a CSS color — including `var(--token)` references and modern
 * syntaxes like oklch() — to a concrete [r, g, b, a] byte array for deck.gl
 * layer props, which only accept numeric color arrays (see tokens.css).
 *
 * Uses an offscreen 1x1 canvas so the browser does the color-space
 * conversion, avoiding hand-rolled oklch math and staying correct for any
 * valid CSS color string regardless of how getComputedStyle serializes it.
 *
 * Results are cached per (color, alpha) pair — but only when they actually
 * resolved: an unresolved token (stylesheet not applied yet, typo'd variable)
 * returns the fallback *uncached*, so the same call after the stylesheet lands
 * gets the real colour instead of a fallback frozen in for the session.
 *
 * Safe to call from useMemo, not
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

/**
 * Fallback RGB used when the color can't be resolved (e.g. jsdom in tests).
 * The requested alpha is kept: callers encode meaning in it (a casing at 210,
 * a halo at 70), and dropping it made those distinctions untestable.
 */
const FALLBACK_RGB: [number, number, number] = [128, 128, 128];

export function resolveMapColor(color: string, alpha = 255): [number, number, number, number] {
  const key = `${color}:${alpha}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let cssColor = color;
  if (color.startsWith("var(")) {
    const match = color.match(/^var\(([^)]+)\)$/);
    const varName = match?.[1];
    const value = varName
      ? getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
      : "";
    // An unresolved token is *not* a colour: handing `var(--x)` to fillStyle is
    // a silent no-op, so the shared canvas would keep whatever the previous
    // caller painted and this token would be cached as that unrelated
    // overlay's colour, forever. Bail to the fallback instead.
    if (!value) return [...FALLBACK_RGB, alpha];
    cssColor = value;
  }

  const ctx = getSharedCtx();
  // No canvas at all (jsdom): also a non-answer, so don't cache it either.
  if (!ctx) return [...FALLBACK_RGB, alpha];

  ctx.clearRect(0, 0, 1, 1);
  // Sentinel: an invalid fillStyle assignment leaves the previous value in
  // place, so reset first and a bad colour reads back as black rather than as
  // the last overlay that used this canvas.
  ctx.fillStyle = "#000";
  ctx.fillStyle = cssColor;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  const rgba: [number, number, number, number] = [r, g, b, alpha];
  cache.set(key, rgba);
  return rgba;
}

/**
 * Drop the resolved-colour cache.
 *
 * Only fully resolved colours are cached, so this exists for tests that
 * restyle a token between renders — and for callers that memoize a ramp of
 * their own, which must reset both (see `resetHeatColorRange`).
 */
export function resetMapColorCache(): void {
  cache.clear();
}
