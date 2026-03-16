import type { DataSource, DataSink, PluginConfig, PluginInfo, ConfigField } from "./types";
import { redactConfig } from "../utils/redact";

/**
 * PluginRegistry — registration and discovery of source/sink plugins.
 *
 * Stores factories at registration time and lazily captures static metadata
 * (type, name, configSchema) on first access, so callers can list available
 * plugins without repeated instantiation.
 */
export class PluginRegistry {
  private sourceFactories = new Map<string, () => DataSource>();
  private sinkFactories = new Map<string, () => DataSink>();

  private sourceMeta = new Map<string, PluginInfo>();
  private sinkMeta = new Map<string, PluginInfo>();

  registerSource(type: string, factory: () => DataSource): void {
    this.sourceFactories.set(type, factory);
    // Clear cached metadata so it will be re-captured from the new factory
    this.sourceMeta.delete(type);
  }

  registerSink(type: string, factory: () => DataSink): void {
    this.sinkFactories.set(type, factory);
    this.sinkMeta.delete(type);
  }

  getSourceFactory(type: string): (() => DataSource) | undefined {
    return this.sourceFactories.get(type);
  }

  getSinkFactory(type: string): (() => DataSink) | undefined {
    return this.sinkFactories.get(type);
  }

  /**
   * Captures and caches metadata from a plugin instance.
   * Called by the manager after creating an instance for connection,
   * so no extra instantiation is needed.
   */
  cacheSourceMeta(type: string, instance: DataSource): void {
    if (!this.sourceMeta.has(type)) {
      this.sourceMeta.set(type, {
        type,
        name: instance.name,
        configSchema: instance.configSchema,
      });
    }
  }

  cacheSinkMeta(type: string, instance: DataSink): void {
    if (!this.sinkMeta.has(type)) {
      this.sinkMeta.set(type, {
        type,
        name: instance.name,
        configSchema: instance.configSchema,
      });
    }
  }

  getSourceInfos(): PluginInfo[] {
    // Ensure metadata is cached for all registered sources
    this.ensureSourceMeta();
    return Array.from(this.sourceMeta.values());
  }

  getSinkInfos(): PluginInfo[] {
    this.ensureSinkMeta();
    return Array.from(this.sinkMeta.values());
  }

  getSourceSchema(type: string): ConfigField[] {
    this.ensureSourceMeta();
    return this.sourceMeta.get(type)?.configSchema ?? [];
  }

  getSinkSchema(type: string): ConfigField[] {
    this.ensureSinkMeta();
    return this.sinkMeta.get(type)?.configSchema ?? [];
  }

  /**
   * Returns source configs with sensitive values redacted,
   * using cached metadata schemas rather than creating new instances.
   */
  redactSourceConfig(configs: Record<string, PluginConfig>): Record<string, PluginConfig> {
    const result: Record<string, PluginConfig> = {};
    for (const [type, pluginConfig] of Object.entries(configs)) {
      const schema = this.getSourceSchema(type);
      result[type] = redactConfig(pluginConfig, schema);
    }
    return result;
  }

  redactSinkConfig(configs: Record<string, PluginConfig>): Record<string, PluginConfig> {
    const result: Record<string, PluginConfig> = {};
    for (const [type, pluginConfig] of Object.entries(configs)) {
      const schema = this.getSinkSchema(type);
      result[type] = redactConfig(pluginConfig, schema);
    }
    return result;
  }

  /**
   * Lazily instantiate any source whose metadata hasn't been cached yet.
   * This happens at most once per registered type.
   */
  private ensureSourceMeta(): void {
    for (const [type, factory] of this.sourceFactories.entries()) {
      if (!this.sourceMeta.has(type)) {
        const instance = factory();
        this.sourceMeta.set(type, {
          type,
          name: instance.name,
          configSchema: instance.configSchema,
        });
      }
    }
  }

  private ensureSinkMeta(): void {
    for (const [type, factory] of this.sinkFactories.entries()) {
      if (!this.sinkMeta.has(type)) {
        const instance = factory();
        this.sinkMeta.set(type, {
          type,
          name: instance.name,
          configSchema: instance.configSchema,
        });
      }
    }
  }
}
