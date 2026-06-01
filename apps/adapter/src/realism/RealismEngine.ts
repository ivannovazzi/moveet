import type { VehicleUpdate } from "../types";
import { createLogger } from "../utils/logger";
import { mulberry32, makeGaussian } from "./rng";
import { resolveRealismConfig } from "./config";
import { gaussMarkovStep, markovStep, metersToLatLon, type ConnState } from "./models";
import type { DeviceState, RealismConfig, RealismStatus, DegradedSample } from "./types";
import type { PublishResult, IngestResult, AcceptedResult } from "../plugins/types";

const logger = createLogger("RealismEngine");

export interface RealismEngineDeps {
  /** Publish degraded updates to all active sinks. */
  publish: (updates: VehicleUpdate[]) => Promise<PublishResult>;
  now?: () => number;
  rng?: () => number;
  config?: Record<string, unknown>;
}

function sampleToUpdate(s: DegradedSample): VehicleUpdate {
  return {
    id: s.id,
    latitude: s.latitude,
    longitude: s.longitude,
    speed: s.speed,
    heading: s.heading,
    accuracy: s.accuracy,
    timestamp: s.timestamp,
    connected: s.connected,
    metadata: s.metadata,
  };
}

/** Per-connection-state GPS parameters. */
function gpsParams(state: ConnState, cfg: RealismConfig): { sigma: number; tau: number } {
  if (state === "degraded") {
    return { sigma: cfg.gps.degradedSigmaM, tau: cfg.gps.degradedTauS };
  }
  return { sigma: cfg.gps.connectedSigmaM, tau: cfg.gps.connectedTauS };
}

export class RealismEngine {
  private cfg: RealismConfig;
  private readonly publish: RealismEngineDeps["publish"];
  private readonly now: () => number;
  private rng: () => number;
  private gaussian: () => number;
  private devices = new Map<string, DeviceState>();
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Re-entrancy guard: skip a tick if a prior (slow) publish is still in flight. */
  private ticking = false;
  /** Scheduler tick (ms). Fine-grained relative to reporting period. */
  private readonly tickMs = 250;

  constructor(deps: RealismEngineDeps) {
    this.publish = deps.publish;
    this.now = deps.now ?? Date.now;
    this.cfg = resolveRealismConfig(deps.config ?? {});
    this.rng = deps.rng ?? (this.cfg.seed != null ? mulberry32(this.cfg.seed) : Math.random);
    this.gaussian = makeGaussian(this.rng);
    if (this.cfg.enabled) this.start();
  }

  getConfig(): RealismConfig {
    return JSON.parse(JSON.stringify(this.cfg));
  }

  isEnabled(): boolean {
    return this.cfg.enabled;
  }

  async ingest(updates: VehicleUpdate[]): Promise<IngestResult> {
    if (!this.cfg.enabled) {
      return this.publish(updates);
    }
    const t = this.now();
    for (const u of updates) {
      const existing = this.devices.get(u.id);
      if (existing) {
        existing.trueLat = u.latitude;
        existing.trueLon = u.longitude;
        existing.trueSpeed = u.speed;
        existing.trueHeading = u.heading;
        existing.metadata = u.metadata;
      } else {
        this.devices.set(u.id, {
          trueLat: u.latitude,
          trueLon: u.longitude,
          trueSpeed: u.speed,
          trueHeading: u.heading,
          metadata: u.metadata,
          errEast: 0,
          errNorth: 0,
          conn: "connected",
          lastStepAt: t,
          nextEmitAt: t,
          buffer: [],
        });
      }
    }
    const result: AcceptedResult = { status: "accepted", accepted: updates.length };
    return result;
  }

  /** Reconfigure live; (re)start or stop the scheduler on enabled change. */
  reconfigure(partial: Record<string, unknown>): RealismConfig {
    const wasEnabled = this.cfg.enabled;
    // Deep-merge the nested groups so a partial gps/connectivity body only
    // overrides the supplied siblings (a shallow spread would reset the others
    // to defaults via resolveRealismConfig). POST /config/realism sends partials.
    const cur = this.getConfig();
    const merged = {
      ...cur,
      ...partial,
      gps: { ...cur.gps, ...((partial.gps as Record<string, unknown>) ?? {}) },
      connectivity: {
        ...cur.connectivity,
        ...((partial.connectivity as Record<string, unknown>) ?? {}),
      },
    };
    this.cfg = resolveRealismConfig(merged);
    if (this.cfg.seed != null) {
      this.rng = mulberry32(this.cfg.seed);
      this.gaussian = makeGaussian(this.rng);
    }
    if (this.cfg.enabled && !wasEnabled) this.start();
    if (!this.cfg.enabled && wasEnabled) {
      this.stop();
      // Drop accumulated per-device state so a later re-enable starts clean —
      // otherwise stale positions and back-dated buffered samples would burst
      // on the first tick after re-enabling.
      this.devices.clear();
    }
    return this.getConfig();
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.tickMs);
    if (typeof this.timer === "object" && "unref" in this.timer) {
      (this.timer as { unref: () => void }).unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus(): RealismStatus {
    let connected = 0;
    let degraded = 0;
    let disconnected = 0;
    let buffered = 0;
    for (const d of this.devices.values()) {
      if (d.conn === "connected") connected++;
      else if (d.conn === "degraded") degraded++;
      else disconnected++;
      buffered += d.buffer.length;
    }
    return {
      enabled: this.cfg.enabled,
      devices: this.devices.size,
      connected,
      degraded,
      disconnected,
      buffered,
    };
  }

  /** Jittered next-emit time from now. */
  private scheduleNext(t: number): number {
    const jitter = this.cfg.jitterMs > 0 ? this.gaussian() * this.cfg.jitterMs : 0;
    return t + Math.max(50, this.cfg.reportingPeriodMs + jitter);
  }

  /** Reported accuracy (m) for a connection state — correlates with sigma. */
  private accuracyFor(state: ConnState): number {
    const { sigma } = gpsParams(state, this.cfg);
    return Math.round(sigma * 1.2 * 10) / 10; // ~R68-ish, 1 decimal
  }

  /** Build a degraded sample for a device at time t (advances FOGM + Markov). */
  private buildSample(id: string, d: DeviceState, t: number): DegradedSample {
    const dtS = Math.max(0, (t - d.lastStepAt) / 1000);
    d.conn = markovStep(d.conn, this.cfg.connectivity, dtS, this.rng);
    const { sigma, tau } = gpsParams(d.conn, this.cfg);
    d.errEast = gaussMarkovStep(d.errEast, sigma, tau, dtS, this.gaussian);
    d.errNorth = gaussMarkovStep(d.errNorth, sigma, tau, dtS, this.gaussian);
    d.lastStepAt = t;
    const { dLat, dLon } = metersToLatLon(d.errEast, d.errNorth, d.trueLat);
    return {
      id,
      latitude: d.trueLat + dLat,
      longitude: d.trueLon + dLon,
      speed: d.trueSpeed,
      heading: d.trueHeading,
      accuracy: this.accuracyFor(d.conn),
      timestamp: t,
      connected: d.conn !== "disconnected",
      metadata: d.metadata,
    };
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const t = this.now();
      const batch: VehicleUpdate[] = [];
      for (const [id, d] of this.devices) {
        if (d.nextEmitAt > t) continue;
        const prevConn = d.conn;
        const sample = this.buildSample(id, d, t);
        d.nextEmitAt = this.scheduleNext(t);

        if (d.conn === "disconnected") {
          if (this.cfg.storeAndForward) {
            d.buffer.push(sample);
            if (d.buffer.length > this.cfg.maxBufferPerDevice) {
              d.buffer.shift();
              logger.warn({ id }, "Realism buffer overflow — dropping oldest sample");
            }
          }
          // drop mode: simply emit nothing
          continue;
        }

        // connected/degraded: flush any buffered backlog first (burst), oldest-first
        if (prevConn === "disconnected" && d.buffer.length > 0) {
          for (const b of d.buffer) batch.push(sampleToUpdate(b));
          d.buffer = [];
        }
        batch.push(sampleToUpdate(sample));
      }
      if (batch.length > 0) {
        try {
          await this.publish(batch);
        } catch (err) {
          logger.error({ err }, "Realism emit failed");
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
