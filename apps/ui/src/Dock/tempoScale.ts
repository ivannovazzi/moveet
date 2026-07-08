/**
 * Log-scale mapping between the 0–100 tempo slider and the 1×–3600×
 * simulation speed multiplier (`SimulationClock.speedMultiplier`). Ported from
 * the old `Controls/ClockPanel.tsx` so the inline dock scrubber and the Tempo
 * details panel share one source of truth.
 */
export const MAX_MULTIPLIER = 3600;
const LOG_MAX = Math.log10(MAX_MULTIPLIER);

export function multiplierToSlider(multiplier: number): number {
  if (multiplier <= 1) return 0;
  return Math.round((Math.log10(Math.max(1, multiplier)) / LOG_MAX) * 100);
}

export function sliderToMultiplier(slider: number): number {
  if (slider <= 0) return 1;
  return Math.round(Math.pow(10, (slider / 100) * LOG_MAX));
}

/** Human phrasing of a multiplier — the "not really speed, just events" framing. */
export function speedDescription(multiplier: number): string {
  if (multiplier === 1) return "real-time";
  if (multiplier === 60) return "1 sim-min per second";
  if (multiplier === 3600) return "1 sim-hour per second";
  if (multiplier % 3600 === 0) return `${multiplier / 3600} sim-hours per second`;
  if (multiplier % 60 === 0) return `${multiplier / 60} sim-mins per second`;
  return `${multiplier}× speed`;
}

export const SPEED_PRESETS = [1, 60, 360, 3600] as const;
