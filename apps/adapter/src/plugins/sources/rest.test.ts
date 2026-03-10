import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RestSource } from "./rest";

describe("RestSource health check", () => {
  let source: RestSource;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    source = new RestSource();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports unhealthy when not connected", async () => {
    const result = await source.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.message).toBeDefined();
  });

  it("reports healthy when URL is reachable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    await source.connect({ url: "http://example.com/vehicles" });

    const result = await source.healthCheck();

    expect(result.healthy).toBe(true);
  });

  it("reports unhealthy when URL returns error status", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await source.connect({ url: "http://example.com/vehicles" });

    const result = await source.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toBeDefined();
  });

  it("reports unhealthy when fetch throws", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await source.connect({ url: "http://unreachable.local/vehicles" });

    const result = await source.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("ECONNREFUSED");
  });
});

describe("RestSource getVehicles", () => {
  let source: RestSource;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    source = new RestSource();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("filters out vehicles with NaN coordinates", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          vehicles: [
            { id: "v1", name: "Good", lat: 1.5, lng: 36.8 },
            { id: "v2", name: "Bad Lat", lat: "not-a-number", lng: 36.8 },
            { id: "v3", name: "Bad Lng", lat: 1.5, lng: "abc" },
            { id: "v4", name: "Missing", lat: undefined, lng: undefined },
          ],
        }),
    });
    await source.connect({ url: "http://example.com/api" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
  });

  it("filters out vehicles with Infinity coordinates", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          vehicles: [
            { id: "v1", name: "Good", lat: -1.28, lng: 36.8 },
            { id: "v2", name: "Inf", lat: Infinity, lng: 36.8 },
          ],
        }),
    });
    await source.connect({ url: "http://example.com/api" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
  });

  it("returns valid vehicles with correct positions", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          vehicles: [{ id: "v1", name: "Vehicle 1", lat: -1.28, lng: 36.82 }],
        }),
    });
    await source.connect({ url: "http://example.com/api" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].position).toEqual([-1.28, 36.82]);
  });
});

describe("RestSource getVehicles timeout", () => {
  let source: RestSource;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.useFakeTimers();
    source = new RestSource();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("aborts getVehicles when the request exceeds the timeout", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        })
    );

    vi.useRealTimers();
    await source.connect({ url: "http://slow.example.com/vehicles" });
    vi.useFakeTimers();

    const promise = source.getVehicles();
    vi.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow("aborted");
  });

  it("passes an AbortSignal to fetch during getVehicles", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ vehicles: [] }),
    });
    vi.useRealTimers();

    await source.connect({ url: "http://example.com/vehicles" });
    await source.getVehicles();

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://example.com/vehicles",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
