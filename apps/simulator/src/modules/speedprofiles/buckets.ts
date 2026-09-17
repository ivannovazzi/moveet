/**
 * Time buckets for learned per-edge speed profiles (fleetsim-all-1ajn.4).
 *
 * A profile is indexed by a bucket of the simulated week: with the default
 * layout (`period: "week"`, `bucketHours: 1`) that is the 168 hours of the
 * week, so Monday 08:00 and Sunday 08:00 learn separately. A `"day"` period
 * folds all weekdays together (24 buckets at 1 h), and wider buckets trade
 * resolution for faster convergence. Timestamps are read in LOCAL time, the
 * same way `SimulationClock.getHour()` reads its clock.
 */

export type BucketPeriod = "week" | "day";

export interface BucketLayout {
  period: BucketPeriod;
  /** Bucket width in hours; divides the period (24 or 168 hours). */
  bucketHours: number;
}

const PERIOD_HOURS: Record<BucketPeriod, number> = { week: 168, day: 24 };
const HOURS_PER_WEEK = 168;

/** Validates a layout, throwing when the bucket width does not divide the period. */
export function parseBucketLayout(period: BucketPeriod, bucketHours: number): BucketLayout {
  const periodHours = PERIOD_HOURS[period];
  if (
    !Number.isInteger(bucketHours) ||
    bucketHours < 1 ||
    bucketHours > periodHours ||
    periodHours % bucketHours !== 0
  ) {
    throw new Error(
      `bucket width ${bucketHours}h must be a whole number of hours dividing the ${period} (${periodHours}h)`
    );
  }
  return { period, bucketHours };
}

export function bucketCount(layout: BucketLayout): number {
  return PERIOD_HOURS[layout.period] / layout.bucketHours;
}

/** Bucket for an hour of the week (0 = Sunday 00:00, 167 = Saturday 23:00). */
export function bucketOfHourOfWeek(layout: BucketLayout, hourOfWeek: number): number {
  const hour = layout.period === "week" ? hourOfWeek : hourOfWeek % 24;
  return Math.floor(hour / layout.bucketHours);
}

/** Bucket for an epoch-ms timestamp, read in local time. */
export function bucketOfTime(layout: BucketLayout, epochMs: number): number {
  const d = new Date(epochMs);
  return bucketOfHourOfWeek(layout, d.getDay() * 24 + d.getHours());
}

export function sameLayout(a: BucketLayout, b: BucketLayout): boolean {
  return a.period === b.period && a.bucketHours === b.bucketHours;
}

/**
 * For every bucket of `from`, the (ascending) buckets of `to` it overlaps.
 * Used to re-bucket persisted or imported profiles recorded under another
 * layout: a coarser source replicates into each finer target bucket it covers,
 * and several finer sources fold into one coarser target.
 */
export function bucketMapping(from: BucketLayout, to: BucketLayout): number[][] {
  const mapping: Set<number>[] = Array.from({ length: bucketCount(from) }, () => new Set());
  for (let hour = 0; hour < HOURS_PER_WEEK; hour++) {
    mapping[bucketOfHourOfWeek(from, hour)].add(bucketOfHourOfWeek(to, hour));
  }
  return mapping.map((targets) => [...targets].sort((a, b) => a - b));
}
