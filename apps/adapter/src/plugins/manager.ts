import type { ExportVehicle, VehicleUpdate, Fleet } from "../types";
import type {
  DataSource,
  DataSink,
  PluginConfig,
  AdapterConfig,
  AdapterStatus,
  PublishResult,
} from "./types";
import { PluginRegistry } from "./registry";
import { HealthAggregator } from "./health-aggregator";
import { Publisher } from "./publisher";

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

  registerSource(type: string, factory: () => DataSource): void {
    this.registry.registerSource(type, factory);
  }

  registerSink(type: string, factory: () => DataSink): void {
    this.registry.registerSink(type, factory);
  }

  async setSource(type: string, pluginConfig: PluginConfig = {}): Promise<void> {
    const factory = this.registry.getSourceFactory(type);
    if (!factory) throw new Error(`Unknown source type: ${type}`);

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
    if (!factory) throw new Error(`Unknown sink type: ${type}`);

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

  async getVehicles(): Promise<ExportVehicle[]> {
    if (!this.activeSource) return [];
    return this.activeSource.getVehicles();
  }

  async getFleets(): Promise<Fleet[]> {
    if (!this.activeSource || !this.activeSource.getFleets) return [];
    return this.activeSource.getFleets();
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<PublishResult> {
    return this.publisher.publishUpdates(updates, this.activeSinks);
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
    if (this.activeSource) await this.activeSource.disconnect();
    for (const sink of this.activeSinks.values()) {
      await sink.disconnect();
    }
    this.activeSinks.clear();
    this.activeSource = null;
  }
}
