import { EventEmitter } from "events";
import type {
  DeviceFaultConfig,
  DeviceFaultInfo,
  DeviceFaultKind,
  DeviceFaultProfile,
  DeviceFaultStatus,
  Position,
  VehicleDTO,
} from "../../types";
import { defaultRng, mulberry32, type Rng } from "../../utils/rng";
import type { FaultConfigPatch } from "./schema";

/**
 * Device-level fault injection.
 *
 * The adapter's realism engine degrades telemetry at egress — it models the
 * TRANSPORT (correlated GPS noise, connectivity dropouts, jittered cadence).
 * This module models the DEVICE: a tracker whose GPS freezes, whose clock is
 * wrong, that retransmits, that reorders, that teleports, that runs out of
 * battery. Faults are therefore properties of a simulated device rather than
 * of the outbound pipe, and they are injected before the telemetry ever leaves
 * the simulator, so a consumer sees them on the WebSocket feed AND in the
 * adapter push. The two layers compose; neither replaces the other.
 *
 * Cardinal rule: with no profile configured (the default), {@link report}
 * returns the DTO it was handed, untouched, and no `timestamp`/`faults` fields
 * appear on the wire. The fault layer is invisible until it is armed.
 *
 * Determinism: each device draws from its OWN `mulberry32` stream, seeded from
 * `(seed, vehicleId)`. That is what makes a fault reproducible under a fixed
 * seed regardless of how many other vehicles exist or in what order they tick.
 * With no seed the streams are `Math.random` and nothing is reproducible.
 */

/** Metres per degree of latitude (spherical approximation). */
const METERS_PER_DEG_LAT = 111_320;

/**
 * Hard cap on faulted samples awaiting an adapter push. The queue exists so
 * stream-shaped faults (duplicates, reordering) survive to the adapter instead
 * of being coalesced into one position per vehicle; it is bounded drop-oldest
 * so a run with no adapter attached cannot grow it without limit. Every device
 * reports on the same game tick, so drop-oldest is uniform across devices.
 */
const MAX_TELEMETRY_QUEUE = 10_000;

export const FAULT_KINDS: readonly DeviceFaultKind[] = [
  "frozen_gps",
  "clock_skew",
  "duplicate",
  "out_of_order",
  "battery_dead",
  "teleport",
] as const;

/** Live per-device state. Rebuilt from scratch on reset or a seed change. */
interface DeviceState {
  /** This device's own stream, so faults don't depend on fleet iteration order. */
  rng: Rng;
  /** First-seen time: the origin for battery drain and clock drift. */
  bornAt: number;
  /** Wall-clock end of the current frozen-GPS window; 0 = not frozen. */
  frozenUntil: number;
  frozenFix: { position: Position; speed: number; heading: number } | null;
  /** Wall-clock end of the current teleport window; 0 = not teleporting. */
  teleportUntil: number;
  teleportOffset: { dLat: number; dLon: number } | null;
  /** Sample withheld by the out-of-order fault, and when it may be released. */
  held: { sample: VehicleDTO; releaseAt: number } | null;
  batteryPercent: number;
  dead: boolean;
  /** Last shaped sample — the device's "current" fix for polling readers. */
  lastSample: VehicleDTO | null;
}

export interface DeviceFaultManagerOptions {
  enabled?: boolean;
  seed?: number;
  default?: DeviceFaultProfile;
  vehicles?: Record<string, DeviceFaultProfile>;
}

/** FNV-1a over the vehicle id, mixed with the configured seed. */
function deviceSeed(seed: number, vehicleId: string): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < vehicleId.length; i++) {
    h ^= vehicleId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** Converts a metric offset at `latitude` into a lat/lon delta. */
function metersToOffset(
  distanceM: number,
  bearingRad: number,
  latitude: number
): { dLat: number; dLon: number } {
  const north = Math.cos(bearingRad) * distanceM;
  const east = Math.sin(bearingRad) * distanceM;
  const cosLat = Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);
  return { dLat: north / METERS_PER_DEG_LAT, dLon: east / (METERS_PER_DEG_LAT * cosLat) };
}

/** Copy of `sample` with one more fault kind recorded on it. */
function withFault(sample: VehicleDTO, kind: DeviceFaultKind): VehicleDTO {
  const faults: DeviceFaultInfo = {
    ...(sample.faults ?? { active: [] }),
    active: [...(sample.faults?.active ?? []), kind],
  };
  return { ...sample, faults };
}

function zeroCounts(): Record<DeviceFaultKind, number> {
  return {
    frozen_gps: 0,
    clock_skew: 0,
    duplicate: 0,
    out_of_order: 0,
    battery_dead: 0,
    teleport: 0,
  };
}

/**
 * Injects per-vehicle device faults into outgoing telemetry.
 *
 * Emits: `faults:config` (the whole {@link DeviceFaultConfig}) whenever the
 * configuration changes, so the UI can follow a runtime edit over WebSocket.
 */
export class DeviceFaultManager extends EventEmitter {
  private enabled: boolean;
  private seed: number | undefined;
  private defaultProfile: DeviceFaultProfile | undefined;
  private profiles = new Map<string, DeviceFaultProfile>();
  private devices = new Map<string, DeviceState>();
  private queue: VehicleDTO[] = [];
  private counts = zeroCounts();
  /** Samples dropped from the egress queue on overflow, for status reporting. */
  private droppedFromQueue = 0;

  constructor(options: DeviceFaultManagerOptions = {}) {
    super();
    this.enabled = options.enabled ?? false;
    this.seed = options.seed;
    this.defaultProfile = options.default;
    for (const [id, profile] of Object.entries(options.vehicles ?? {})) {
      this.profiles.set(id, profile);
    }
  }

  // ─── Queries ──────────────────────────────────────────────────────

  /**
   * True when fault injection is enabled AND at least one profile exists.
   * Callers use this to skip the fault path entirely, keeping the unfaulted
   * hot path exactly what it was before this module existed.
   */
  isActive(): boolean {
    return this.enabled && (this.defaultProfile !== undefined || this.profiles.size > 0);
  }

  getConfig(): DeviceFaultConfig {
    return {
      enabled: this.enabled,
      ...(this.seed !== undefined ? { seed: this.seed } : {}),
      ...(this.defaultProfile !== undefined ? { default: this.defaultProfile } : {}),
      vehicles: Object.fromEntries(this.profiles),
    };
  }

  getStatus(): DeviceFaultStatus {
    let frozen = 0;
    let teleporting = 0;
    let dead = 0;
    let held = 0;
    for (const device of this.devices.values()) {
      if (device.dead) dead++;
      if (device.frozenFix) frozen++;
      if (device.teleportOffset) teleporting++;
      if (device.held) held++;
    }
    return {
      enabled: this.enabled,
      devices: this.devices.size,
      frozen,
      teleporting,
      dead,
      held,
      queued: this.queue.length,
      counts: { ...this.counts },
    };
  }

  /** Profile governing a vehicle: its override, else the fleet-wide default. */
  private profileFor(vehicleId: string): DeviceFaultProfile | undefined {
    return this.profiles.get(vehicleId) ?? this.defaultProfile;
  }

  // ─── Configuration ────────────────────────────────────────────────

  /**
   * Applies a validated partial configuration and returns the resolved config.
   *
   * Toggling `enabled` or changing `seed` discards all per-device state: a
   * re-enable that resumed a half-drained battery, or a reseed that kept the
   * old RNG streams, would break the reproducibility guarantee this module
   * exists to provide.
   */
  configure(patch: FaultConfigPatch): DeviceFaultConfig {
    let stateInvalidated = false;

    if (patch.enabled !== undefined && patch.enabled !== this.enabled) {
      this.enabled = patch.enabled;
      stateInvalidated = true;
    }
    if (patch.seed !== undefined && patch.seed !== this.seed) {
      this.seed = patch.seed;
      stateInvalidated = true;
    }
    if (patch.default !== undefined) {
      this.defaultProfile = patch.default ?? undefined;
    }
    if (patch.vehicles !== undefined) {
      for (const [id, profile] of Object.entries(patch.vehicles)) {
        this.profiles.set(id, profile);
      }
    }

    if (stateInvalidated) this.resetDevices();
    return this.publishConfig();
  }

  setVehicleProfile(vehicleId: string, profile: DeviceFaultProfile): DeviceFaultConfig {
    this.profiles.set(vehicleId, profile);
    // Drop this device's latched state so the new profile starts from a clean
    // device rather than inheriting a frozen window from the old one.
    this.devices.delete(vehicleId);
    return this.publishConfig();
  }

  /** Removes a per-vehicle override. Returns false when there was none. */
  clearVehicleProfile(vehicleId: string): boolean {
    if (!this.profiles.delete(vehicleId)) return false;
    this.devices.delete(vehicleId);
    this.publishConfig();
    return true;
  }

  private publishConfig(): DeviceFaultConfig {
    const config = this.getConfig();
    this.emit("faults:config", config);
    return config;
  }

  // ─── Reset ────────────────────────────────────────────────────────

  /** Clears all device state and counters. Configuration is preserved. */
  reset(): void {
    this.resetDevices();
    this.counts = zeroCounts();
    this.droppedFromQueue = 0;
  }

  private resetDevices(): void {
    this.devices.clear();
    this.queue = [];
  }

  // ─── Telemetry ────────────────────────────────────────────────────

  /**
   * Shapes one device report. Returns the samples the device actually emits:
   * usually one, none when the device is silent (dead battery, or a sample
   * withheld by the out-of-order fault), several when it duplicates or
   * releases a withheld sample after a newer one.
   *
   * The returned samples are also queued for the next adapter push, so the
   * stream-shaped faults survive to the downstream sinks rather than being
   * coalesced into one position per vehicle.
   */
  report(dto: VehicleDTO, now: number): VehicleDTO[] {
    const profile = this.profileFor(dto.id);
    if (!this.enabled || !profile) return [dto];

    const device = this.device(dto.id, now);
    const sample = this.shape(dto, device, profile, now, true);
    if (sample === null) return [];
    device.lastSample = sample;

    const out: VehicleDTO[] = [];

    // ── Out-of-order: withhold this sample so a newer one overtakes it ──
    if (profile.outOfOrder) {
      if (device.held && now >= device.held.releaseAt) {
        // Newer sample first, then the older withheld one: the stream is now
        // genuinely out of order by timestamp, which is the point.
        out.push(sample, device.held.sample);
        device.held = null;
      } else if (!device.held && device.rng.next() < profile.outOfOrder.probability) {
        device.held = {
          sample: withFault(sample, "out_of_order"),
          releaseAt: now + profile.outOfOrder.holdMs,
        };
        this.counts.out_of_order++;
      } else {
        out.push(sample);
      }
    } else {
      out.push(sample);
    }

    // ── Duplicate: the device retransmits what it just sent ──
    // Only when the fresh sample actually went out; there is nothing to
    // retransmit in the tick where it was withheld.
    if (
      profile.duplicate &&
      out[0] === sample &&
      device.rng.next() < profile.duplicate.probability
    ) {
      const copies = 1 + Math.floor(device.rng.next() * profile.duplicate.maxCopies);
      for (let i = 0; i < copies; i++) out.push(withFault(sample, "duplicate"));
      this.counts.duplicate++;
    }

    this.enqueue(out);
    return out;
  }

  /**
   * The device's currently-reported fix, WITHOUT advancing any fault state.
   *
   * Used by the pollable surfaces (`GET /vehicles`, out-of-band `update`
   * frames such as a fleet reassignment) so a frozen device does not appear to
   * un-freeze whenever something other than the game loop reads it. Draws no
   * random numbers, so it cannot perturb reproducibility.
   */
  view(dto: VehicleDTO, now: number): VehicleDTO {
    const profile = this.profileFor(dto.id);
    if (!this.enabled || !profile) return dto;
    const device = this.devices.get(dto.id);
    // Nothing reported yet: there is no device state to project.
    if (!device) return dto;

    const sample = this.shape(dto, device, profile, now, false);
    if (sample !== null) return sample;
    // Dead device: show the last fix it managed to send, flagged as dead, so a
    // reader sees a stale position rather than a live one.
    const last = device.lastSample ?? dto;
    return withFault(
      { ...last, faults: { ...(last.faults ?? { active: [] }), battery: 0 } },
      "battery_dead"
    );
  }

  /** Takes every queued faulted sample, in emission order, and clears the queue. */
  drainTelemetry(): VehicleDTO[] {
    if (this.queue.length === 0) return [];
    const drained = this.queue;
    this.queue = [];
    return drained;
  }

  private enqueue(samples: VehicleDTO[]): void {
    if (samples.length === 0) return;
    this.queue.push(...samples);
    const overflow = this.queue.length - MAX_TELEMETRY_QUEUE;
    if (overflow > 0) {
      // Drop-oldest: for position telemetry the newest fix supersedes stale ones.
      this.queue.splice(0, overflow);
      this.droppedFromQueue += overflow;
    }
  }

  /** Number of samples dropped from the egress queue on overflow. */
  getDroppedCount(): number {
    return this.droppedFromQueue;
  }

  private device(vehicleId: string, now: number): DeviceState {
    let device = this.devices.get(vehicleId);
    if (device) return device;
    device = {
      rng: this.seed === undefined ? defaultRng : mulberry32(deviceSeed(this.seed, vehicleId)),
      bornAt: now,
      frozenUntil: 0,
      frozenFix: null,
      teleportUntil: 0,
      teleportOffset: null,
      held: null,
      batteryPercent: 100,
      dead: false,
      lastSample: null,
    };
    this.devices.set(vehicleId, device);
    return device;
  }

  /**
   * Applies the position/time faults to one report.
   *
   * With `advance` true this is the device reporting: fault windows may open
   * and RNG is drawn. With `advance` false it only projects state that is
   * already latched, which is what {@link view} needs. Returns `null` when the
   * device is silent (dead battery).
   */
  private shape(
    dto: VehicleDTO,
    device: DeviceState,
    profile: DeviceFaultProfile,
    now: number,
    advance: boolean
  ): VehicleDTO | null {
    const active: DeviceFaultKind[] = [];

    // ── Battery: a dead device emits nothing at all ──
    let battery: number | undefined;
    if (profile.battery) {
      const hours = Math.max(0, now - device.bornAt) / 3_600_000;
      battery = Math.max(
        0,
        profile.battery.initialPercent - profile.battery.drainPercentPerHour * hours
      );
      device.batteryPercent = battery;
      if (battery <= profile.battery.dieAtPercent) {
        if (advance && !device.dead) {
          device.dead = true;
          this.counts.battery_dead++;
        }
        return null;
      }
      device.dead = false;
    } else {
      device.batteryPercent = 100;
      device.dead = false;
    }

    let position: Position = dto.position;
    let speed = dto.speed;
    let heading = dto.heading;

    // ── Frozen GPS: the device replays its latched fix ──
    if (profile.frozenGps) {
      if (now < device.frozenUntil && device.frozenFix) {
        position = device.frozenFix.position;
        speed = device.frozenFix.speed;
        heading = device.frozenFix.heading;
        active.push("frozen_gps");
      } else if (advance) {
        device.frozenUntil = 0;
        device.frozenFix = null;
        if (device.rng.next() < profile.frozenGps.probability) {
          const { minDurationMs, maxDurationMs } = profile.frozenGps;
          const duration = minDurationMs + device.rng.next() * (maxDurationMs - minDurationMs);
          device.frozenUntil = now + duration;
          device.frozenFix = { position, speed, heading };
          active.push("frozen_gps");
          this.counts.frozen_gps++;
        }
      }
    }

    // ── Teleport / spoofing: the fix jumps somewhere it cannot be ──
    if (profile.teleport) {
      if (now < device.teleportUntil && device.teleportOffset) {
        position = [
          position[0] + device.teleportOffset.dLat,
          position[1] + device.teleportOffset.dLon,
        ];
        active.push("teleport");
      } else if (advance) {
        device.teleportUntil = 0;
        device.teleportOffset = null;
        if (device.rng.next() < profile.teleport.probability) {
          const bearing = device.rng.next() * 2 * Math.PI;
          const distance = device.rng.next() * profile.teleport.radiusMeters;
          const offset = metersToOffset(distance, bearing, position[0]);
          device.teleportOffset = offset;
          // holdMs 0 leaves `teleportUntil === now`, so the jump lasts exactly
          // this one sample — a glitch rather than a spoofing session.
          device.teleportUntil = now + profile.teleport.holdMs;
          position = [position[0] + offset.dLat, position[1] + offset.dLon];
          active.push("teleport");
          this.counts.teleport++;
        }
      }
    }

    // ── Clock skew: the device stamps its fix with the wrong time ──
    let timestamp = now;
    let skewMs: number | undefined;
    if (profile.clockSkew) {
      const minutes = Math.max(0, now - device.bornAt) / 60_000;
      const skew = profile.clockSkew.offsetMs + (profile.clockSkew.driftMsPerMinute ?? 0) * minutes;
      if (skew !== 0) {
        skewMs = Math.round(skew);
        timestamp = now + skewMs;
        active.push("clock_skew");
        if (advance) this.counts.clock_skew++;
      }
    }

    const faults: DeviceFaultInfo = {
      active,
      ...(battery !== undefined ? { battery: Math.round(battery * 10) / 10 } : {}),
      ...(skewMs !== undefined ? { skewMs } : {}),
    };

    return { ...dto, position, speed, heading, timestamp, faults };
  }
}
