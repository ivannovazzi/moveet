import { describe, it, expect, vi } from "vitest";
import { RealismEngine } from "./RealismEngine";

function makeEngine(overrides = {}) {
  const publish = vi.fn().mockResolvedValue({ status: "success", sinks: [] });
  let t = 0;
  const now = () => t;
  const engine = new RealismEngine({
    publish,
    now,
    rng: () => 0.5,
    config: overrides,
  });
  return { engine, publish, advance: (ms: number) => (t += ms), getT: () => t };
}

describe("RealismEngine (disabled)", () => {
  it("passes ingest straight through to publish and returns its result", async () => {
    const { engine, publish } = makeEngine({ enabled: false });
    const updates = [{ id: "v1", latitude: 1, longitude: 2 }];
    const res = await engine.ingest(updates);
    expect(publish).toHaveBeenCalledWith(updates);
    expect(res).toEqual({ status: "success", sinks: [] });
  });
});

describe("RealismEngine (enabled) ingest", () => {
  it("does NOT publish on ingest; stores true state", async () => {
    const { engine, publish } = makeEngine({ enabled: true });
    const res = await engine.ingest([{ id: "v1", latitude: 1, longitude: 2 }]);
    expect(publish).not.toHaveBeenCalled();
    expect(res).toMatchObject({ status: "accepted" });
    expect(engine.getStatus().devices).toBe(1);
  });
});
