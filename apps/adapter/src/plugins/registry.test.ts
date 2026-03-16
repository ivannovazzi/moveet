import { describe, it, expect, vi } from "vitest";
import { PluginRegistry } from "./registry";
import type { DataSource, DataSink, ConfigField } from "./types";

function createMockSource(overrides?: Partial<DataSource>): DataSource {
  return {
    type: "mock-source",
    name: "Mock Source",
    configSchema: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
    getVehicles: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    ...overrides,
  };
}

function createMockSink(overrides?: Partial<DataSink>): DataSink {
  return {
    type: "mock-sink",
    name: "Mock Sink",
    configSchema: [],
    connect: vi.fn(),
    disconnect: vi.fn(),
    publishUpdates: vi.fn().mockResolvedValue(undefined),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true }),
    ...overrides,
  };
}

describe("PluginRegistry", () => {
  describe("source registration", () => {
    it("registers and retrieves a source factory", () => {
      const registry = new PluginRegistry();
      const source = createMockSource();
      const factory = () => source;

      registry.registerSource("test", factory);

      expect(registry.getSourceFactory("test")).toBe(factory);
    });

    it("returns undefined for unregistered source", () => {
      const registry = new PluginRegistry();
      expect(registry.getSourceFactory("nonexistent")).toBeUndefined();
    });

    it("overwrites factory when re-registering same type", () => {
      const registry = new PluginRegistry();
      const factory1 = () => createMockSource();
      const factory2 = () => createMockSource({ name: "Source v2" });

      registry.registerSource("test", factory1);
      registry.registerSource("test", factory2);

      expect(registry.getSourceFactory("test")).toBe(factory2);
    });
  });

  describe("sink registration", () => {
    it("registers and retrieves a sink factory", () => {
      const registry = new PluginRegistry();
      const sink = createMockSink();
      const factory = () => sink;

      registry.registerSink("test", factory);

      expect(registry.getSinkFactory("test")).toBe(factory);
    });

    it("returns undefined for unregistered sink", () => {
      const registry = new PluginRegistry();
      expect(registry.getSinkFactory("nonexistent")).toBeUndefined();
    });
  });

  describe("metadata caching", () => {
    it("caches source metadata from an instance", () => {
      const registry = new PluginRegistry();
      const schema: ConfigField[] = [
        { name: "url", label: "URL", type: "string", required: true },
      ];
      const source = createMockSource({ name: "My Source", configSchema: schema });

      registry.registerSource("test", () => source);
      registry.cacheSourceMeta("test", source);

      const infos = registry.getSourceInfos();
      expect(infos).toEqual([
        { type: "test", name: "My Source", configSchema: schema },
      ]);
    });

    it("caches sink metadata from an instance", () => {
      const registry = new PluginRegistry();
      const schema: ConfigField[] = [
        { name: "topic", label: "Topic", type: "string", required: true },
      ];
      const sink = createMockSink({ name: "My Sink", configSchema: schema });

      registry.registerSink("test", () => sink);
      registry.cacheSinkMeta("test", sink);

      const infos = registry.getSinkInfos();
      expect(infos).toEqual([
        { type: "test", name: "My Sink", configSchema: schema },
      ]);
    });

    it("does not overwrite already cached metadata", () => {
      const registry = new PluginRegistry();
      const source1 = createMockSource({ name: "First" });
      const source2 = createMockSource({ name: "Second" });

      registry.registerSource("test", () => source1);
      registry.cacheSourceMeta("test", source1);
      registry.cacheSourceMeta("test", source2);

      const infos = registry.getSourceInfos();
      expect(infos[0].name).toBe("First");
    });

    it("clears cached metadata when re-registering", () => {
      const registry = new PluginRegistry();
      const source1 = createMockSource({ name: "Original" });
      const source2 = createMockSource({ name: "Replacement" });

      registry.registerSource("test", () => source1);
      registry.cacheSourceMeta("test", source1);
      expect(registry.getSourceInfos()[0].name).toBe("Original");

      // Re-register clears metadata cache
      registry.registerSource("test", () => source2);
      registry.cacheSourceMeta("test", source2);
      expect(registry.getSourceInfos()[0].name).toBe("Replacement");
    });
  });

  describe("lazy metadata fallback", () => {
    it("instantiates factory to get metadata if not cached", () => {
      const registry = new PluginRegistry();
      const schema: ConfigField[] = [
        { name: "url", label: "URL", type: "string" },
      ];
      const factory = vi.fn(() =>
        createMockSource({ name: "Lazy Source", configSchema: schema })
      );

      registry.registerSource("lazy", factory);

      // No cacheSourceMeta called — metadata should be lazily fetched
      const infos = registry.getSourceInfos();
      expect(infos).toEqual([
        { type: "lazy", name: "Lazy Source", configSchema: schema },
      ]);
      expect(factory).toHaveBeenCalledTimes(1);

      // Second call should not instantiate again (metadata is now cached)
      registry.getSourceInfos();
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it("lazily instantiates sink factory for metadata", () => {
      const registry = new PluginRegistry();
      const factory = vi.fn(() =>
        createMockSink({ name: "Lazy Sink" })
      );

      registry.registerSink("lazy", factory);

      const infos = registry.getSinkInfos();
      expect(infos[0].name).toBe("Lazy Sink");
      expect(factory).toHaveBeenCalledTimes(1);
    });
  });

  describe("plugin info lists", () => {
    it("returns infos for multiple registered sources", () => {
      const registry = new PluginRegistry();
      registry.registerSource("a", () => createMockSource({ name: "Source A" }));
      registry.registerSource("b", () => createMockSource({ name: "Source B" }));

      const infos = registry.getSourceInfos();
      expect(infos).toHaveLength(2);
      expect(infos.map((i) => i.type)).toEqual(["a", "b"]);
    });

    it("returns infos for multiple registered sinks", () => {
      const registry = new PluginRegistry();
      registry.registerSink("x", () => createMockSink({ name: "Sink X" }));
      registry.registerSink("y", () => createMockSink({ name: "Sink Y" }));

      const infos = registry.getSinkInfos();
      expect(infos).toHaveLength(2);
    });

    it("returns empty arrays when nothing registered", () => {
      const registry = new PluginRegistry();
      expect(registry.getSourceInfos()).toEqual([]);
      expect(registry.getSinkInfos()).toEqual([]);
    });
  });

  describe("schema retrieval", () => {
    it("returns source schema by type", () => {
      const registry = new PluginRegistry();
      const schema: ConfigField[] = [
        { name: "url", label: "URL", type: "string", required: true },
      ];
      registry.registerSource("test", () => createMockSource({ configSchema: schema }));
      registry.cacheSourceMeta("test", createMockSource({ configSchema: schema }));

      expect(registry.getSourceSchema("test")).toEqual(schema);
    });

    it("returns empty array for unknown source type", () => {
      const registry = new PluginRegistry();
      expect(registry.getSourceSchema("unknown")).toEqual([]);
    });

    it("returns sink schema by type", () => {
      const registry = new PluginRegistry();
      const schema: ConfigField[] = [
        { name: "topic", label: "Topic", type: "string" },
      ];
      registry.registerSink("test", () => createMockSink({ configSchema: schema }));
      registry.cacheSinkMeta("test", createMockSink({ configSchema: schema }));

      expect(registry.getSinkSchema("test")).toEqual(schema);
    });

    it("returns empty array for unknown sink type", () => {
      const registry = new PluginRegistry();
      expect(registry.getSinkSchema("unknown")).toEqual([]);
    });
  });

  describe("config redaction", () => {
    it("redacts sensitive source config using stored schema", () => {
      const registry = new PluginRegistry();
      const schema: ConfigField[] = [
        { name: "url", label: "URL", type: "string" },
        { name: "token", label: "Token", type: "password" },
      ];
      registry.registerSource("graphql", () =>
        createMockSource({ configSchema: schema })
      );
      registry.cacheSourceMeta(
        "graphql",
        createMockSource({ configSchema: schema })
      );

      const result = registry.redactSourceConfig({
        graphql: { url: "http://api.com", token: "secret-123" },
      });

      expect(result.graphql.url).toBe("http://api.com");
      expect(result.graphql.token).toBe("\u2022\u2022\u2022\u2022\u2022\u2022");
    });

    it("redacts sensitive sink config using stored schema", () => {
      const registry = new PluginRegistry();
      const schema: ConfigField[] = [
        { name: "brokers", label: "Brokers", type: "string" },
        { name: "password", label: "Password", type: "password" },
      ];
      registry.registerSink("kafka", () =>
        createMockSink({ configSchema: schema })
      );
      registry.cacheSinkMeta("kafka", createMockSink({ configSchema: schema }));

      const result = registry.redactSinkConfig({
        kafka: { brokers: "localhost:9092", password: "secret" },
      });

      expect(result.kafka.brokers).toBe("localhost:9092");
      expect(result.kafka.password).toBe("\u2022\u2022\u2022\u2022\u2022\u2022");
    });

    it("handles configs for types with no schema gracefully", () => {
      const registry = new PluginRegistry();

      const result = registry.redactSourceConfig({
        unknown: { url: "http://example.com" },
      });

      // No schema found, so nothing redacted (except name-pattern matches)
      expect(result.unknown.url).toBe("http://example.com");
    });
  });
});
