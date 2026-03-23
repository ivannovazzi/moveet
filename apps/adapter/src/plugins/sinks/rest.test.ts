import { describe, it, expect, vi, beforeEach } from "vitest";
import { RestSink } from "./rest";

vi.mock("../../utils/httpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/httpClient")>();
  return {
    ...actual,
    httpFetch: vi.fn(),
  };
});

import { httpFetch } from "../../utils/httpClient";
const mockHttpFetch = vi.mocked(httpFetch);

const vehicle1 = { id: "v1", latitude: -1.28, longitude: 36.8 };
const vehicle2 = { id: "v2", latitude: -1.29, longitude: 36.81 };

describe("RestSink", () => {
  let sink: RestSink;

  beforeEach(() => {
    sink = new RestSink();
    mockHttpFetch.mockReset();
    mockHttpFetch.mockResolvedValue(new Response("", { status: 200 }));
  });

  it("has correct type and name", () => {
    expect(sink.type).toBe("rest");
    expect(sink.name).toBe("REST API");
  });

  it("has config schema", () => {
    expect(sink.configSchema.length).toBeGreaterThan(0);
    expect(sink.configSchema.find((f) => f.name === "url")!.required).toBe(true);
  });

  describe("connect", () => {
    it("throws if url is missing", async () => {
      await expect(sink.connect({})).rejects.toThrow("REST sink requires url");
    });

    it("connects with url", async () => {
      await sink.connect({ url: "http://example.com/api" });
      await sink.publishUpdates([vehicle1]);
      expect(mockHttpFetch).toHaveBeenCalled();
    });

    it("accepts custom method", async () => {
      await sink.connect({ url: "http://example.com/api", method: "PUT" });
      await sink.publishUpdates([vehicle1]);
      expect(mockHttpFetch).toHaveBeenCalledWith(
        "http://example.com/api",
        expect.objectContaining({ method: "PUT" })
      );
    });

    it("uppercases method", async () => {
      await sink.connect({ url: "http://example.com/api", method: "patch" });
      await sink.publishUpdates([vehicle1]);
      expect(mockHttpFetch).toHaveBeenCalledWith(
        "http://example.com/api",
        expect.objectContaining({ method: "PATCH" })
      );
    });

    it("accepts custom headers", async () => {
      await sink.connect({
        url: "http://example.com/api",
        headers: { "X-Api-Key": "secret" },
      });
      await sink.publishUpdates([vehicle1]);
      expect(mockHttpFetch).toHaveBeenCalledWith(
        "http://example.com/api",
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "X-Api-Key": "secret",
          }),
        })
      );
    });
  });

  describe("disconnect", () => {
    it("resets state so publish throws", async () => {
      await sink.connect({ url: "http://example.com/api" });
      await sink.disconnect();
      await expect(sink.publishUpdates([vehicle1])).rejects.toThrow("REST sink not connected");
    });
  });

  describe("publishUpdates", () => {
    it("throws when not connected", async () => {
      await expect(sink.publishUpdates([vehicle1])).rejects.toThrow("REST sink not connected");
    });

    it("returns early for empty updates", async () => {
      await sink.connect({ url: "http://example.com/api" });
      await sink.publishUpdates([]);
      expect(mockHttpFetch).not.toHaveBeenCalled();
    });

    describe("batch mode (default)", () => {
      it("sends all vehicles in one request", async () => {
        await sink.connect({ url: "http://example.com/api" });
        await sink.publishUpdates([vehicle1, vehicle2]);

        expect(mockHttpFetch).toHaveBeenCalledTimes(1);
        expect(mockHttpFetch).toHaveBeenCalledWith(
          "http://example.com/api",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({ "Content-Type": "application/json" }),
            body: JSON.stringify({ vehicles: [vehicle1, vehicle2] }),
          })
        );
      });
    });

    describe("non-batch mode", () => {
      beforeEach(async () => {
        await sink.connect({ url: "http://example.com/api", batchMode: false });
      });

      it("sends individual requests per vehicle", async () => {
        await sink.publishUpdates([vehicle1, vehicle2]);

        expect(mockHttpFetch).toHaveBeenCalledTimes(2);
        expect(mockHttpFetch).toHaveBeenCalledWith(
          "http://example.com/api",
          expect.objectContaining({ body: JSON.stringify(vehicle1) })
        );
        expect(mockHttpFetch).toHaveBeenCalledWith(
          "http://example.com/api",
          expect.objectContaining({ body: JSON.stringify(vehicle2) })
        );
      });

      it("returns result with counts on success", async () => {
        const result = await sink.publishUpdates([vehicle1, vehicle2]);

        expect(result).toEqual({
          attempted: 2,
          succeeded: 2,
          failures: [],
        });
      });

      it("handles partial failures via Promise.allSettled", async () => {
        mockHttpFetch
          .mockResolvedValueOnce(new Response("", { status: 200 }))
          .mockRejectedValueOnce(new Error("Connection refused"));

        const result = await sink.publishUpdates([vehicle1, vehicle2]);

        expect(result).toEqual({
          attempted: 2,
          succeeded: 1,
          failures: [{ itemId: "v2", error: "Connection refused" }],
        });
      });

      it("throws when all requests fail", async () => {
        mockHttpFetch.mockRejectedValue(new Error("Server down"));

        await expect(sink.publishUpdates([vehicle1, vehicle2])).rejects.toThrow(
          "All 2 vehicle updates failed"
        );
      });

      it("includes first error message when all fail", async () => {
        mockHttpFetch
          .mockRejectedValueOnce(new Error("First error"))
          .mockRejectedValueOnce(new Error("Second error"));

        await expect(sink.publishUpdates([vehicle1, vehicle2])).rejects.toThrow("First error");
      });

      it("handles non-Error rejection reasons", async () => {
        mockHttpFetch
          .mockResolvedValueOnce(new Response("", { status: 200 }))
          .mockRejectedValueOnce("string-error");

        const result = await sink.publishUpdates([vehicle1, vehicle2]);

        expect(result).toEqual({
          attempted: 2,
          succeeded: 1,
          failures: [{ itemId: "v2", error: "string-error" }],
        });
      });
    });
  });

  describe("healthCheck", () => {
    it("returns unhealthy when not connected", async () => {
      const result = await sink.healthCheck();
      expect(result.healthy).toBe(false);
      expect(result.message).toBe("not connected");
    });

    it("sends HEAD request and returns healthy", async () => {
      await sink.connect({ url: "http://example.com/api" });
      const result = await sink.healthCheck();

      expect(result.healthy).toBe(true);
      expect(mockHttpFetch).toHaveBeenCalledWith(
        "http://example.com/api",
        { method: "HEAD" },
        { timeoutMs: 3000, maxRetries: 1 }
      );
    });

    it("returns unhealthy on fetch error", async () => {
      mockHttpFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      await sink.connect({ url: "http://example.com/api" });

      const result = await sink.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toBe("ECONNREFUSED");
    });

    it("handles non-Error thrown values", async () => {
      mockHttpFetch.mockRejectedValue("raw-string-error");
      await sink.connect({ url: "http://example.com/api" });

      const result = await sink.healthCheck();

      expect(result.healthy).toBe(false);
      expect(result.message).toBe("raw-string-error");
    });
  });
});
