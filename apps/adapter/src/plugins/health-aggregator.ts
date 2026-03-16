import type { DataSource, DataSink, AdapterStatus, PluginInfo } from "./types";

/**
 * HealthAggregator — coordinates health checks across source and sink plugins.
 */
export class HealthAggregator {
  async getStatus(
    activeSource: DataSource | null,
    activeSinks: Map<string, DataSink>,
    availableSources: PluginInfo[],
    availableSinks: PluginInfo[]
  ): Promise<AdapterStatus> {
    const sourceStatus = await this.checkSource(activeSource);
    const sinkStatuses = await this.checkSinks(activeSinks);

    return {
      source: sourceStatus,
      sinks: sinkStatuses,
      availableSources,
      availableSinks,
    };
  }

  private async checkSource(
    source: DataSource | null
  ): Promise<AdapterStatus["source"]> {
    if (!source) return null;

    try {
      const result = await source.healthCheck();
      return {
        type: source.type,
        healthy: result.healthy,
        message: result.message,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { type: source.type, healthy: false, message };
    }
  }

  private async checkSinks(
    sinks: Map<string, DataSink>
  ): Promise<AdapterStatus["sinks"]> {
    return Promise.all(
      Array.from(sinks.entries()).map(async ([type, sink]) => {
        try {
          const result = await sink.healthCheck();
          return { type, healthy: result.healthy, message: result.message };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { type, healthy: false, message };
        }
      })
    );
  }
}
