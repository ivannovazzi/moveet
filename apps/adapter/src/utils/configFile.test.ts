import { describe, it, expect, vi } from "vitest";
import { loadConfig } from "./config";
import { loadPluginConfigFile } from "./configFile";

vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));

/** Fake filesystem reader so the suite never touches disk. */
function reader(contents: unknown) {
  return vi.fn(() => (typeof contents === "string" ? contents : JSON.stringify(contents)));
}

const FILE = "/etc/moveet/adapter.json";

describe("loadPluginConfigFile", () => {
  it("returns null when no path is configured", () => {
    expect(loadPluginConfigFile(undefined)).toBeNull();
    expect(loadPluginConfigFile("")).toBeNull();
    expect(loadPluginConfigFile("   ")).toBeNull();
  });

  it("resolves the path to an absolute path and reports it", () => {
    const read = reader({ sinks: [{ type: "console" }] });
    const loaded = loadPluginConfigFile("relative/adapter.json", read);
    expect(loaded?.path.startsWith("/")).toBe(true);
    expect(read).toHaveBeenCalledWith(loaded?.path);
  });

  it("defaults missing sections", () => {
    const loaded = loadPluginConfigFile(FILE, reader({}));
    expect(loaded?.contents).toEqual({ sinks: [], realism: {} });
  });

  it("throws naming the file when it cannot be read", () => {
    const read = vi.fn(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    expect(() => loadPluginConfigFile(FILE, read)).toThrow(
      /Cannot read adapter config file .*adapter\.json .*ENOENT/
    );
  });

  it("throws naming the file when the JSON is malformed", () => {
    expect(() => loadPluginConfigFile(FILE, reader("{broken"))).toThrow(
      /Invalid JSON in adapter config file .*adapter\.json/
    );
  });

  it("rejects a non-object document", () => {
    expect(() => loadPluginConfigFile(FILE, reader([1, 2, 3]))).toThrow(
      /expected a JSON object with optional "source", "sinks" and "realism" keys/
    );
  });

  it("rejects an unknown top-level key (a typo must not be silently ignored)", () => {
    const read = reader({ sink: [{ type: "console" }] });
    expect(() => loadPluginConfigFile(FILE, read)).toThrow(/Invalid adapter config file/);
    expect(() => loadPluginConfigFile(FILE, read)).toThrow(/sink/);
  });

  it("rejects a plugin entry without a type", () => {
    expect(() => loadPluginConfigFile(FILE, reader({ sinks: [{ config: {} }] }))).toThrow(
      /sinks\.0\.type/
    );
  });

  it("rejects an unknown key inside a plugin entry", () => {
    const read = reader({ sinks: [{ type: "console", conifg: {} }] });
    expect(() => loadPluginConfigFile(FILE, read)).toThrow(/conifg/);
  });
});

describe("loadConfig with ADAPTER_CONFIG_FILE", () => {
  it("loads source, sinks and realism from the file when no env vars are set", () => {
    const read = reader({
      source: { type: "rest", config: { url: "http://roster.local" } },
      sinks: [
        { type: "redpanda", config: { brokers: "broker:9092", topic: "t" } },
        { type: "console", config: { verbose: true } },
      ],
      realism: { enabled: true },
    });

    const cfg = loadConfig({ ADAPTER_CONFIG_FILE: FILE }, read);

    expect(cfg.source).toEqual({ type: "rest", config: { url: "http://roster.local" } });
    expect(cfg.sinks).toEqual([
      { type: "redpanda", config: { brokers: "broker:9092", topic: "t" } },
      { type: "console", config: { verbose: true } },
    ]);
    expect(cfg.realism).toEqual({ enabled: true });
    expect(cfg.origins.configFile).toBe(FILE);
    expect(cfg.origins.source).toBe("file");
    expect(cfg.origins.sinkList).toBe("file");
  });

  it("lets SOURCE_CONFIG override the file key by key (env wins, file fills the rest)", () => {
    const read = reader({
      source: { type: "rest", config: { url: "http://file.local", vehiclePath: "assignments" } },
    });

    const cfg = loadConfig(
      { ADAPTER_CONFIG_FILE: FILE, SOURCE_CONFIG: '{"url":"http://env.local"}' },
      read
    );

    expect(cfg.source.config).toEqual({
      url: "http://env.local",
      vehiclePath: "assignments",
    });
    expect(cfg.origins.source).toBe("env+file");
  });

  it("lets SOURCE_TYPE override the file type and drops the file's config for the other type", () => {
    const read = reader({
      source: { type: "rest", config: { url: "http://file.local" } },
    });

    const cfg = loadConfig({ ADAPTER_CONFIG_FILE: FILE, SOURCE_TYPE: "static" }, read);

    expect(cfg.source.type).toBe("static");
    expect(cfg.source.config).toEqual({ count: 20 });
  });

  it("lets SINK_TYPES replace the file's sink list wholesale", () => {
    const read = reader({
      sinks: [
        { type: "redpanda", config: { brokers: "broker:9092" } },
        { type: "redis", config: { host: "cache" } },
      ],
    });

    const cfg = loadConfig({ ADAPTER_CONFIG_FILE: FILE, SINK_TYPES: "redpanda" }, read);

    expect(cfg.sinks).toEqual([{ type: "redpanda", config: { brokers: "broker:9092" } }]);
    expect(cfg.origins.sinkList).toBe("env");
    expect(cfg.origins.sinks.redpanda).toBe("file");
  });

  it("shallow-merges SINK_<TYPE>_CONFIG over the file entry of the same type", () => {
    const read = reader({
      sinks: [{ type: "redpanda", config: { brokers: "file:9092", topic: "from-file" } }],
    });

    const cfg = loadConfig(
      { ADAPTER_CONFIG_FILE: FILE, SINK_REDPANDA_CONFIG: '{"brokers":"env:9092"}' },
      read
    );

    expect(cfg.sinks).toEqual([
      { type: "redpanda", config: { brokers: "env:9092", topic: "from-file" } },
    ]);
    expect(cfg.origins.sinks.redpanda).toBe("env+file");
  });

  it("shallow-merges REALISM_CONFIG over the file's realism section", () => {
    const read = reader({ realism: { enabled: true, jitterMs: 800 } });

    const cfg = loadConfig({ ADAPTER_CONFIG_FILE: FILE, REALISM_CONFIG: '{"jitterMs":100}' }, read);

    expect(cfg.realism).toEqual({ enabled: true, jitterMs: 100 });
    expect(cfg.origins.realism).toBe("env+file");
  });

  it("still falls back to the default console sink when neither env nor file define sinks", () => {
    const cfg = loadConfig(
      { ADAPTER_CONFIG_FILE: FILE },
      reader({ source: { type: "static", config: { count: 5 } } })
    );

    expect(cfg.sinks).toEqual([{ type: "console", config: {} }]);
    expect(cfg.origins.sinkList).toBe("default");
    expect(cfg.source.config).toEqual({ count: 5 });
  });

  it("propagates a broken config file as a thrown configuration error", () => {
    const read = vi.fn(() => {
      throw new Error("ENOENT: no such file or directory");
    });
    expect(() => loadConfig({ ADAPTER_CONFIG_FILE: FILE }, read)).toThrow(
      /Cannot read adapter config file/
    );
  });

  it("does not read any file when ADAPTER_CONFIG_FILE is unset", () => {
    const read = reader({});
    const cfg = loadConfig({ SOURCE_TYPE: "static" }, read);
    expect(read).not.toHaveBeenCalled();
    expect(cfg.origins.configFile).toBeNull();
    expect(cfg.origins.source).toBe("env");
  });
});
