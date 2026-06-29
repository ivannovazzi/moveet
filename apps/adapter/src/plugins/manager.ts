import type { ExportVehicle, VehicleUpdate, Fleet } from "../types";
import type {
  DataSource,
  DataSink,
  PluginConfig,
  AdapterConfig,
  AdapterStatus,
  IngestResult,
  PublishResult,
} from "./types";
import { PluginRegistry } from "./registry";
import { HealthAggregator } from "./health-aggregator";
import { Publisher } from "./publisher";
import { RealismEngine } from "../realism/RealismEngine";
import type { RealismConfig, RealismStatus } from "../realism/types";
import { createLogger } from "../utils/logger";

const logger = createLogger("PluginManager");

/** Default cadence for the unhealthy-sink reconnect loop (ms). */
const DEFAULT_SINK_RECONNECT_INTERVAL_MS = 30_000;

/**
 * PluginManager — backward-compatible facade that delegates to focused classes.
 *
 * - PluginRegistry  handles registration, discovery, metadata, and config redaction
 * - HealthAggregator handles health-check coordination
 * - Publisher        handles fan-out publishing to sinks
 *
 * PluginManager retains lifecycle orchestration (connect/disconnect/shutdown)
 * and configuration state, plus the data-read path (getVehicles/getFleets).
 */
export class PluginManager {
  readonly registry = new PluginRegistry();
  private readonly healthAggregator = new HealthAggregator();
  private readonly publisher = new Publisher();

  private activeSource: DataSource | null = null;
  private activeSinks = new Map<string, DataSink>();

  private config: AdapterConfig = {
    activeSource: null,
    activeSinks: [],
    sourceConfig: {},
    sinkConfig: {},
  };

  private readonly realism: RealismEngine;

  /** Handle for the periodic sink-reconnect loop; null when not running. */
  private sinkReconnectTimer: ReturnType<typeof setInterval> | null = null;
  /** Guards against overlapping reconnect sweeps if one runs long. */
  private reconnecting = false;

  constructor(realismConfig: Record<string, unknown> = {}) {
    this.realism = new RealismEngine({
      publish: (updates) => this.publisher.publishUpdates(updates, this.activeSinks),
      config: realismConfig,
    });
  }

  registerSource(type: string, factory: () => DataSource): void {
    this.registry.registerSource(type, factory);
  }

  registerSink(type: string, factory: () => DataSink): void {
    this.registry.registerSink(type, factory);
  }

  async setSource(type: string, pluginConfig: PluginConfig = {}): Promise<void> {
    const factory = this.registry.getSourceFactory(type);
    if (!factory) {
      throw new Error(
        `Unknown source type: ${type} (valid types: ${this.registry.getSourceTypes().join(", ")})`
      );
    }

    const source = factory();
    this.registry.cacheSourceMeta(type, source);
    await source.connect(pluginConfig);

    if (this.activeSource) {
      try {
        await this.activeSource.disconnect();
      } catch {
        // Best-effort disconnect — new source is already connected
      }
    }

    this.activeSource = source;
    this.config.activeSource = type;
    this.config.sourceConfig[type] = pluginConfig;
  }

  async addSink(type: string, pluginConfig: PluginConfig = {}): Promise<void> {
    const factory = this.registry.getSinkFactory(type);
    if (!factory) {
      throw new Error(
        `Unknown sink type: ${type} (valid types: ${this.registry.getSinkTypes().join(", ")})`
      );
    }

    const sink = factory();
    this.registry.cacheSinkMeta(type, sink);
    await sink.connect(pluginConfig);

    // Remove existing sink of same type (now safe because new one connected)
    if (this.activeSinks.has(type)) {
      await this.activeSinks.get(type)!.disconnect();
    }

    this.activeSinks.set(type, sink);

    if (!this.config.activeSinks.includes(type)) {
      this.config.activeSinks.push(type);
    }
    this.config.sinkConfig[type] = pluginConfig;
  }

  async removeSink(type: string): Promise<void> {
    const sink = this.activeSinks.get(type);
    if (sink) {
      await sink.disconnect();
      this.activeSinks.delete(type);
      this.config.activeSinks = this.config.activeSinks.filter((t) => t !== type);
    }
  }

  /**
   * Start a periodic, health-driven reconnect loop for sinks.
   *
   * Startup already skips a sink whose backend is down, but a broker that dies
   * AFTER startup would otherwise stay broken forever (publishes report
   * partial/failure indefinitely) until a manual re-add via the API. This loop
   * health-checks each active sink and re-`addSink`s any unhealthy one with its
   * last-known config, recovering automatically once the backend returns.
   *
   * Idempotent: a second call is a no-op while a loop is already running. The
   * timer is `unref`'d so it never keeps the process alive on its own.
   */
  startSinkReconnectLoop(intervalMs: number = DEFAULT_SINK_RECONNECT_INTERVAL_MS): void {
    if (this.sinkReconnectTimer) return;
    this.sinkReconnectTimer = setInterval(() => {
      void this.reconnectUnhealthySinks();
    }, intervalMs);
    this.sinkReconnectTimer.unref?.();
  }

  /** Stop the periodic sink-reconnect loop (no-op if not running). */
  stopSinkReconnectLoop(): void {
    if (this.sinkReconnectTimer) {
      clearInterval(this.sinkReconnectTimer);
      this.sinkReconnectTimer = null;
    }
  }

  /**
   * One reconnect sweep: health-check every active sink and re-connect any that
   * is unhealthy, reusing its stored config. Re-entrancy guarded so a slow sweep
   * never overlaps the next tick. Errors are logged, never thrown — a sink whose
   * backend is still down simply stays unhealthy until the next sweep.
   *
   * Returns the list of sink types that were successfully reconnected (useful
   * for tests and for callers that want to observe recovery).
   */
  async reconnectUnhealthySinks(): Promise<string[]> {
    if (this.reconnecting) return [];
    this.reconnecting = true;
    const reconnected: string[] = [];
    try {
      const entries = Array.from(this.activeSinks.entries());
      for (const [type, sink] of entries) {
        let healthy = false;
        try {
          healthy = (await sink.healthCheck()).healthy;
        } catch (err) {
          logger.warn(
            { sink: type, err: err instanceof Error ? err.message : err },
            "Sink health check threw during reconnect sweep — treating as unhealthy"
          );
        }
        if (healthy) continue;

        const config = this.config.sinkConfig[type] ?? {};
        try {
          // addSink connects a fresh instance and only swaps it in on success,
          // so a failed reconnect leaves the previous (broken) sink in place.
          await this.addSink(type, config);
          reconnected.push(type);
          logger.info({ sink: type }, "Reconnected previously-unhealthy sink");
        } catch (err) {
          logger.warn(
            { sink: type, err: err instanceof Error ? err.message : err },
            "Sink reconnect attempt failed — will retry on the next sweep"
          );
        }
      }
    } finally {
      this.reconnecting = false;
    }
    return reconnected;
  }

  async getVehicles(): Promise<ExportVehicle[]> {
    if (!this.activeSource) return [];
    return this.activeSource.getVehicles();
  }

  async getFleets(): Promise<Fleet[]> {
    if (!this.activeSource || !this.activeSource.getFleets) return [];
    return this.activeSource.getFleets();
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<IngestResult> {
    return this.realism.ingest(updates);
  }

  /**
   * Publish straight to the active sinks, bypassing the manager's realism
   * engine. Used by the replay emitter, which owns its own virtual-clock-driven
   * RealismEngine and so must not double-apply degradation here.
   */
  async publishToSinks(updates: VehicleUpdate[]): Promise<PublishResult> {
    return this.publisher.publishUpdates(updates, this.activeSinks);
  }

  getRealismConfig(): RealismConfig {
    return this.realism.getConfig();
  }

  setRealismConfig(partial: Record<string, unknown>): RealismConfig {
    return this.realism.reconfigure(partial);
  }

  getRealismStatus(): RealismStatus {
    return this.realism.getStatus();
  }

  async getStatus(): Promise<AdapterStatus> {
    return this.healthAggregator.getStatus(
      this.activeSource,
      this.activeSinks,
      this.registry.getSourceInfos(),
      this.registry.getSinkInfos()
    );
  }

  getConfig(): AdapterConfig {
    return { ...this.config };
  }

  getSafeConfig(): AdapterConfig {
    const cfg = this.getConfig();
    return {
      ...cfg,
      sourceConfig: this.registry.redactSourceConfig(cfg.sourceConfig),
      sinkConfig: this.registry.redactSinkConfig(cfg.sinkConfig),
    };
  }

  async shutdown(): Promise<void> {
    this.stopSinkReconnectLoop();
    this.realism.stop();
    if (this.activeSource) await this.activeSource.disconnect();
    for (const sink of this.activeSinks.values()) {
      await sink.disconnect();
    }
    this.activeSinks.clear();
    this.activeSource = null;
  }
}
