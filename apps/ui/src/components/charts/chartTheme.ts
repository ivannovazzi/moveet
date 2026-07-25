/**
 * The one place chart marks get their colour and weight.
 *
 * Every chart in the app reads these, so the analytics surface reads as a
 * single system instead of per-chart colour choices. Values are **semantic
 * theme tokens** (the oklch `@theme` block in `src/index.css`) — never hex.
 *
 * Colour assignment follows the data-viz rule set:
 *
 *  • Every plot here is a **single series** (small multiples faceted by
 *    measure, and per-fleet sparklines), so the colour job is magnitude/trend,
 *    not identity. One hue — the theme accent — carries every mark. There is
 *    deliberately no categorical ramp: introducing one would spend the identity
 *    channel re-encoding what the facet title already says, and would need a
 *    legend per facet.
 *  • `--color-accent` (oklch 0.62 0.15 250 → #2f8adc) measures **4.86:1**
 *    against the panel surface (`surface-raised` ≈ #16191d) and clears the
 *    lightness-band, chroma-floor and 3:1 contrast checks in dark mode
 *    (verified with the data-viz palette validator).
 *  • Status tokens stay reserved for state. They appear only on the KPI delta
 *    chips and the fleet status dot, and always alongside an arrow glyph and a
 *    text label, so meaning never rests on hue alone.
 */
export const chartTheme = {
  /** The single series hue for every data mark. */
  series: "var(--color-accent)",
  /** Area wash under a line — a hint of the hue, never a saturated block. */
  areaOpacity: 0.1,
  /** Line weight in CSS px (kept non-scaling under a stretched viewBox). */
  strokeWidth: 2,
  /** Sparklines sit at tile scale; a hair thinner reads better there. */
  sparkStrokeWidth: 1.5,
  /** Hairline grid, one step off the surface. Solid, never dashed. */
  grid: "var(--color-border-soft)",
  /** The baseline / crosshair rule — a touch stronger than the grid. */
  axis: "var(--color-border)",
  /** Surface colour behind the marks: the 2px ring on end dots uses it. */
  surface: "var(--color-card)",
  /** Radius of the end-of-series dot (≥ 4 → an ≥ 8px marker). */
  dotRadius: 4,
} as const;
