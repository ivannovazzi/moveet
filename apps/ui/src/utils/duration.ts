/**
 * Duration and arrival-time formatting, shared by every surface that prints an
 * ETA. It lived as three near-identical private copies (the telemetry
 * sparklines, the directions header, the jobs board) which had already drifted
 * on what to render for a missing value.
 */

/**
 * Seconds → "45 s" / "12 min" / "1 h 5 min".
 *
 * Returns `empty` (default "—") for anything that is not a positive finite
 * number, so a missing ETA reads as a gap rather than "0 s" — the simulator
 * omits the field entirely for an unrouted vehicle, and inventing a zero there
 * would say "arriving now".
 */
export function formatDuration(seconds: number | null | undefined, empty = "—"): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return empty;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} h ${minutes} min` : `${hours} h`;
}

/**
 * Wall-clock arrival time for an ETA, as "14:32".
 *
 * The number an operator actually acts on: "18 minutes" has to be added to the
 * current time before it means anything, and they are reading it against a
 * clock on the wall. `now` is injectable so tests don't depend on the moment
 * they run.
 */
export function formatArrivalTime(
  seconds: number | null | undefined,
  now: number = Date.now(),
  empty = "—"
): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return empty;
  return new Date(now + seconds * 1000).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
