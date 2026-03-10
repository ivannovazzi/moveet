import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConsoleSink } from "../plugins/sinks/console";

describe("ConsoleSink", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("has correct type and name", () => {
    const sink = new ConsoleSink();
    expect(sink.type).toBe("console");
    expect(sink.name).toBe("Console Logger");
  });

  it("logs summary in non-verbose mode", async () => {
    const sink = new ConsoleSink();
    await sink.connect({});
    await sink.publishUpdates([
      { id: "v1", latitude: -1.3, longitude: 36.8 },
      { id: "v2", latitude: -1.2, longitude: 36.7 },
    ]);
    expect(console.log).toHaveBeenCalledWith("[ConsoleSink] 2 vehicle updates published");
  });

  it("logs full details in verbose mode", async () => {
    const sink = new ConsoleSink();
    await sink.connect({ verbose: true });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("[ConsoleSink] 1 updates:"),
      expect.stringContaining("v1")
    );
  });

  it("health check always returns true", async () => {
    const sink = new ConsoleSink();
    expect(await sink.healthCheck()).toMatchObject({ healthy: true });
  });

  it("has config schema", () => {
    const sink = new ConsoleSink();
    expect(sink.configSchema).toBeDefined();
    expect(sink.configSchema.find((f) => f.name === "verbose")).toBeDefined();
  });
});
