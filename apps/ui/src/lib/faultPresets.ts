import type {
  DeviceFaultConfig,
  DeviceFaultKind,
  DeviceFaultProfile,
  DeviceFaultStatus,
} from "@/types";

/** Operator-facing wording for the wire's snake_case fault kinds. */
export const FAULT_KIND_LABEL: Record<DeviceFaultKind, string> = {
  frozen_gps: "frozen",
  clock_skew: "clock",
  duplicate: "duplicate",
  out_of_order: "reordered",
  battery_dead: "battery",
  teleport: "spoofed",
};

export interface FaultPreset {
  id: string;
  label: string;
  hint: string;
  profile: DeviceFaultProfile;
}

/**
 * Ready-made device profiles.
 *
 * These are the misbehaviours a downstream consumer actually has to survive,
 * each expressed as one named device rather than as six independent probability
 * knobs. Values are deliberately visible-within-a-minute at the default report
 * cadence: a preset that fires once an hour teaches an operator nothing.
 */
export const FAULT_PRESETS: FaultPreset[] = [
  {
    id: "flaky-gps",
    label: "Flaky GPS",
    hint: "The tracker latches its last fix for seconds at a time",
    profile: {
      frozenGps: { probability: 0.15, minDurationMs: 5_000, maxDurationMs: 20_000 },
    },
  },
  {
    id: "bad-clock",
    label: "Bad clock",
    hint: "Device timestamps run 45s late and drift further as it runs",
    profile: {
      clockSkew: { offsetMs: -45_000, driftMsPerMinute: 250 },
    },
  },
  {
    id: "chatty",
    label: "Chatty",
    hint: "Retransmits: duplicate samples, and some arriving out of order",
    profile: {
      duplicate: { probability: 0.25, maxCopies: 2 },
      outOfOrder: { probability: 0.15, holdMs: 4_000 },
    },
  },
  {
    id: "dying-battery",
    label: "Dying battery",
    hint: "Drains fast from 40% and goes silent at 5%",
    profile: {
      battery: { initialPercent: 40, drainPercentPerHour: 120, dieAtPercent: 5 },
    },
  },
  {
    id: "spoofed",
    label: "Spoofed",
    hint: "Position jumps up to 2km away and holds there briefly",
    profile: {
      teleport: { probability: 0.08, radiusMeters: 2000, holdMs: 10_000 },
    },
  },
  {
    id: "worst-case",
    label: "Worst case",
    hint: "Everything at once — the integration test nobody wants to fail",
    profile: {
      frozenGps: { probability: 0.1, minDurationMs: 4_000, maxDurationMs: 15_000 },
      clockSkew: { offsetMs: 30_000, driftMsPerMinute: 100 },
      duplicate: { probability: 0.2, maxCopies: 3 },
      outOfOrder: { probability: 0.1, holdMs: 3_000 },
      battery: { initialPercent: 60, drainPercentPerHour: 90, dieAtPercent: 2 },
      teleport: { probability: 0.05, radiusMeters: 1500, holdMs: 8_000 },
    },
  },
];

/** One-line summary of what a profile does, for a list row. */
export function describeProfile(profile: DeviceFaultProfile): string {
  const parts: string[] = [];
  if (profile.frozenGps) parts.push(`freeze ${pct(profile.frozenGps.probability)}`);
  if (profile.clockSkew) parts.push(`skew ${Math.round(profile.clockSkew.offsetMs / 1000)}s`);
  if (profile.duplicate) parts.push(`dupe ${pct(profile.duplicate.probability)}`);
  if (profile.outOfOrder) parts.push(`reorder ${pct(profile.outOfOrder.probability)}`);
  if (profile.battery) parts.push(`battery ${profile.battery.initialPercent}%`);
  if (profile.teleport) parts.push(`spoof ${pct(profile.teleport.probability)}`);
  return parts.length > 0 ? parts.join(" · ") : "nothing armed";
}

/**
 * Devices currently misbehaving in a way an operator would want badged: a fix
 * that isn't moving, a device that has gone silent, or a position that isn't
 * real. Withheld/queued samples are in-flight bookkeeping, not a bad device, so
 * they are deliberately excluded. Reads as zero while the layer is disarmed —
 * latched counters from an earlier armed run must not badge a quiet fleet.
 */
export function countMisbehavingDevices(
  config: DeviceFaultConfig | null,
  status: DeviceFaultStatus | null
): number {
  if (!config?.enabled || !status) return 0;
  return status.frozen + status.dead + status.teleporting;
}

/** Which preset (if any) a profile is, so the panel can mark it as active. */
export function matchPreset(profile: DeviceFaultProfile | undefined): FaultPreset | undefined {
  if (!profile) return undefined;
  const serialized = JSON.stringify(profile);
  return FAULT_PRESETS.find((p) => JSON.stringify(p.profile) === serialized);
}

function pct(probability: number): string {
  return `${Math.round(probability * 100)}%`;
}
