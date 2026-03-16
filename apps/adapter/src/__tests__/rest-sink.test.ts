import { describe, it, expect, vi, beforeEach } from "vitest";
import { RestSink } from "../plugins/sinks/rest";

vi.mock("../utils/httpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/httpClient")>();
  return {
    ...actual,
    httpFetch: vi.fn(),
  };
});

import { httpFetch } from "../utils/httpClient";
const mockHttpFetch = vi.mocked(httpFetch);

describe("RestSink", () => {
  beforeEach(() => {
    mockHttpFetch.mockReset();
    mockHttpFetch.mockResolvedValue(new Response("", { status: 200 }));
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

    expect(mockHttpFetch).toHaveBeenCalledTimes(1);
    const callArgs = mockHttpFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1]!.body as string);
    expect(body.vehicles).toHaveLength(2);
  });

  it("sends individual requests when batchMode is false", async () => {
    const sink = new RestSink();
    await sink.connect({ url: "https://api.example.com/sync", batchMode: false });
    await sink.publishUpdates([
      { id: "v1", latitude: -1.3, longitude: 36.8 },
      { id: "v2", latitude: -1.2, longitude: 36.7 },
    ]);

    expect(mockHttpFetch).toHaveBeenCalledTimes(2);
  });

  it("uses configured HTTP method", async () => {
    const sink = new RestSink();
    await sink.connect({ url: "https://api.example.com/sync", method: "PUT" });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);

    expect(mockHttpFetch.mock.calls[0][1]!.method).toBe("PUT");
  });

  it("skips empty updates", async () => {
    const sink = new RestSink();
    await sink.connect({ url: "https://api.example.com/sync" });
    await sink.publishUpdates([]);
    expect(mockHttpFetch).not.toHaveBeenCalled();
  });

  it("has config schema", () => {
    const sink = new RestSink();
    expect(sink.configSchema.length).toBeGreaterThan(0);
    expect(sink.configSchema.find((f) => f.name === "url")!.required).toBe(true);
  });

  describe("partial failure handling (non-batch mode)", () => {
    it("returns success result when all individual requests succeed", async () => {
      const sink = new RestSink();
      await sink.connect({ url: "https://api.example.com/sync", batchMode: false });

      const result = await sink.publishUpdates([
        { id: "v1", latitude: -1.3, longitude: 36.8 },
        { id: "v2", latitude: -1.2, longitude: 36.7 },
        { id: "v3", latitude: -1.1, longitude: 36.6 },
      ]);

      expect(result).toEqual({
        attempted: 3,
        succeeded: 3,
        failures: [],
      });
    });

    it("returns partial success with failure details when some requests fail", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      // v1 succeeds, v2 fails, v3 succeeds
      mockHttpFetch
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(new Error("connection refused"))
        .mockResolvedValueOnce({ ok: true });

      const sink = new RestSink();
      await sink.connect({ url: "https://api.example.com/sync", batchMode: false });

      const result = await sink.publishUpdates([
        { id: "v1", latitude: -1.3, longitude: 36.8 },
        { id: "v2", latitude: -1.2, longitude: 36.7 },
        { id: "v3", latitude: -1.1, longitude: 36.6 },
      ]);

      expect(result).toEqual({
        attempted: 3,
        succeeded: 2,
        failures: [{ itemId: "v2", error: "connection refused" }],
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to publish update for vehicle v2")
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Partial failure: 2/3 updates succeeded")
      );

      consoleSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("throws when all individual requests fail", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});

      mockHttpFetch
        .mockRejectedValueOnce(new Error("timeout"))
        .mockRejectedValueOnce(new Error("timeout"));

      const sink = new RestSink();
      await sink.connect({ url: "https://api.example.com/sync", batchMode: false });

      await expect(
        sink.publishUpdates([
          { id: "v1", latitude: -1.3, longitude: 36.8 },
          { id: "v2", latitude: -1.2, longitude: 36.7 },
        ])
      ).rejects.toThrow("All 2 vehicle updates failed");
    });

    it("logs each failed vehicle ID individually", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});

      mockHttpFetch
        .mockResolvedValueOnce({ ok: true })
        .mockRejectedValueOnce(new Error("err-a"))
        .mockRejectedValueOnce(new Error("err-b"))
        .mockResolvedValueOnce({ ok: true });

      const sink = new RestSink();
      await sink.connect({ url: "https://api.example.com/sync", batchMode: false });

      await sink.publishUpdates([
        { id: "v1", latitude: -1.3, longitude: 36.8 },
        { id: "v2", latitude: -1.2, longitude: 36.7 },
        { id: "v3", latitude: -1.1, longitude: 36.6 },
        { id: "v4", latitude: -1.0, longitude: 36.5 },
      ]);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("vehicle v2"));
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("vehicle v3"));

      consoleSpy.mockRestore();
    });
  });
});
