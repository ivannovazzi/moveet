import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConsoleSink } from "./console";

describe("ConsoleSink", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("has type 'console'", () => {
    const sink = new ConsoleSink();
    expect(sink.type).toBe("console");
  });

  it("logs summary by default", async () => {
    const sink = new ConsoleSink();
    await sink.connect({});
    await sink.publishUpdates([
      { id: "v1", latitude: -1.28, longitude: 36.8 },
      { id: "v2", latitude: -1.29, longitude: 36.81 },
    ]);
    expect(console.log).toHaveBeenCalledWith("[ConsoleSink] 2 vehicle updates published");
  });

  it("logs details in verbose mode", async () => {
    const sink = new ConsoleSink();
    await sink.connect({ verbose: true });
    await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }]);
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("[ConsoleSink] 1 updates:"),
      expect.any(String)
    );
  });

  it("healthCheck returns true", async () => {
    const sink = new ConsoleSink();
    await sink.connect({});
    expect(await sink.healthCheck()).toMatchObject({ healthy: true });
  });
});
