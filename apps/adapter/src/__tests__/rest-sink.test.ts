import { describe, it, expect, vi, beforeEach } from "vitest";
import { RestSink } from "../plugins/sinks/rest";

describe("RestSink", () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("has correct type and name", () => {
    const sink = new RestSink();
    expect(sink.type).toBe("rest");
    expect(sink.name).toBe("REST API");
  });

  it("requires url", async () => {
    const sink = new RestSink();
    await expect(sink.connect({})).rejects.toThrow("REST sink requires url");
  });

  it("sends batch updates in a single request by default", async () => {
    const sink = new RestSink();
    await sink.connect({ url: "https://api.example.com/sync" });
    await sink.publishUpdates([
      { id: "v1", latitude: -1.3, longitude: 36.8 },
      { id: "v2", latitude: -1.2, longitude: 36.7 },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.vehicles).toHaveLength(2);
  });

  it("sends individual requests when batchMode is false", async () => {
    const sink = new RestSink();
    await sink.connect({ url: "https://api.example.com/sync", batchMode: false });
    await sink.publishUpdates([
      { id: "v1", latitude: -1.3, longitude: 36.8 },
      { id: "v2", latitude: -1.2, longitude: 36.7 },
    ]);

    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it("uses configured HTTP method", async () => {
    const sink = new RestSink();
    await sink.connect({ url: "https://api.example.com/sync", method: "PUT" });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);

    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");
  });

  it("skips empty updates", async () => {
    const sink = new RestSink();
    await sink.connect({ url: "https://api.example.com/sync" });
    await sink.publishUpdates([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("has config schema", () => {
    const sink = new RestSink();
    expect(sink.configSchema.length).toBeGreaterThan(0);
    expect(sink.configSchema.find((f) => f.name === "url")!.required).toBe(true);
  });
});
