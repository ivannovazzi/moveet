import type { ExportVehicle, VehicleUpdate } from "../types";
import type {
  DataSource,
  DataSink,
  PluginConfig,
  AdapterConfig,
  AdapterStatus,
  PluginInfo,
  PublishResult,
  SinkResult,
} from "./types";
import { redactConfig } from "../utils/redact";

export class PluginManager {
  private sourceRegistry = new Map<string, () => DataSource>();
  private sinkRegistry = new Map<string, () => DataSink>();

  private activeSource: DataSource | null = null;
  private activeSinks = new Map<string, DataSink>();

  private config: AdapterConfig = {
    activeSource: null,
    activeSinks: [],
    sourceConfig: {},
    sinkConfig: {},
  };

  registerSource(type: string, factory: () => DataSource): void {
    this.sourceRegistry.set(type, factory);
  }

  registerSink(type: string, factory: () => DataSink): void {
    this.sinkRegistry.set(type, factory);
  }

  async setSource(type: string, pluginConfig: PluginConfig = {}): Promise<void> {
    const factory = this.sourceRegistry.get(type);
    if (!factory) throw new Error(`Unknown source type: ${type}`);

    const source = factory();
    await source.connect(pluginConfig); // connect new first — if this throws, old source is untouched

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
    const factory = this.sinkRegistry.get(type);
    if (!factory) throw new Error(`Unknown sink type: ${type}`);

    const sink = factory();
    await sink.connect(pluginConfig); // connect new first — if this throws, old sink is untouched

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

  async publishUpdates(updates: VehicleUpdate[]): Promise<PublishResult> {
    const sinkEntries = Array.from(this.activeSinks.entries());

    const sinkResults: SinkResult[] = await Promise.all(
      sinkEntries.map(async ([type, sink]) => {
        try {
          await sink.publishUpdates(updates);
          return { type, success: true };
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          console.error(`Sink ${type} error:`, err);
          return { type, success: false, error };
        }
      })
    );

    const failCount = sinkResults.filter((r) => !r.success).length;
    let status: PublishResult["status"];
    if (failCount === 0) {
      status = "success";
    } else if (failCount < sinkResults.length) {
      status = "partial";
    } else {
      status = "failure";
    }

    return { status, sinks: sinkResults };
  }

  async getStatus(): Promise<AdapterStatus> {
    let sourceStatus: AdapterStatus["source"] = null;
    if (this.activeSource) {
      try {
        const result = await this.activeSource.healthCheck();
        sourceStatus = {
          type: this.activeSource.type,
          healthy: result.healthy,
          message: result.message,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sourceStatus = { type: this.activeSource.type, healthy: false, message };
      }
    }

    const sinkStatuses = await Promise.all(
      Array.from(this.activeSinks.entries()).map(async ([type, sink]) => {
        try {
          const result = await sink.healthCheck();
          return { type, healthy: result.healthy, message: result.message };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { type, healthy: false, message };
        }
      })
    );

    return {
      source: sourceStatus,
      sinks: sinkStatuses,
      availableSources: this.getSourceInfos(),
      availableSinks: this.getSinkInfos(),
    };
  }

  getConfig(): AdapterConfig {
    return { ...this.config };
  }

  getSafeConfig(): AdapterConfig {
    const cfg = this.getConfig();

    const redactPluginConfigs = (
      configs: Record<string, PluginConfig>,
      registry: Map<string, () => DataSource | DataSink>
    ): Record<string, PluginConfig> => {
      const result: Record<string, PluginConfig> = {};
      for (const [type, pluginConfig] of Object.entries(configs)) {
        const factory = registry.get(type);
        const schema = factory ? factory().configSchema : [];
        result[type] = redactConfig(pluginConfig, schema);
      }
      return result;
    };

    return {
      ...cfg,
      sourceConfig: redactPluginConfigs(cfg.sourceConfig, this.sourceRegistry),
      sinkConfig: redactPluginConfigs(cfg.sinkConfig, this.sinkRegistry),
    };
  }

  private getSourceInfos(): PluginInfo[] {
    return Array.from(this.sourceRegistry.entries()).map(([type, factory]) => {
      const instance = factory();
      return { type, name: instance.name, configSchema: instance.configSchema };
    });
  }

  private getSinkInfos(): PluginInfo[] {
    return Array.from(this.sinkRegistry.entries()).map(([type, factory]) => {
      const instance = factory();
      return { type, name: instance.name, configSchema: instance.configSchema };
    });
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
