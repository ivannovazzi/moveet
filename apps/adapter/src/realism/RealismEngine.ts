import type { VehicleUpdate } from "../types";
import { createLogger } from "../utils/logger";
import { mulberry32, makeGaussian } from "./rng";
import { resolveRealismConfig } from "./config";
import { gaussMarkovStep, markovStep, metersToLatLon, type ConnState } from "./models";
import type { DeviceState, RealismConfig, RealismStatus, DegradedSample } from "./types";

const logger = createLogger("RealismEngine");

export interface RealismEngineDeps {
  /** Publish degraded updates to all active sinks. */
  publish: (updates: VehicleUpdate[]) => Promise<unknown>;
  now?: () => number;
  rng?: () => number;
  config?: Record<string, unknown>;
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

  async ingest(updates: VehicleUpdate[]): Promise<unknown> {
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
    return { status: "accepted", accepted: updates.length };
  }

  /** Reconfigure live; (re)start or stop the scheduler on enabled change. */
  reconfigure(partial: Record<string, unknown>): RealismConfig {
    const wasEnabled = this.cfg.enabled;
    this.cfg = resolveRealismConfig({ ...this.getConfig(), ...partial });
    if (this.cfg.seed != null) {
      this.rng = mulberry32(this.cfg.seed);
      this.gaussian = makeGaussian(this.rng);
    }
    if (this.cfg.enabled && !wasEnabled) this.start();
    if (!this.cfg.enabled && wasEnabled) this.stop();
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

  /** One scheduler tick — implemented in the next task. */
  async tick(): Promise<void> {
    // placeholder; filled in Task 8
  }
}
