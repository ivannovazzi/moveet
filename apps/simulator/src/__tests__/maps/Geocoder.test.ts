import { describe, expect, it, vi } from "vitest";
import {
  Geocoder,
  GeocodeRateLimitError,
  GeocodeUpstreamError,
  toGeocodeResult,
} from "../../modules/maps/Geocoder";
import type { FetchLike } from "../../modules/maps/GeofabrikIndex";

const BERGAMO = {
  display_name: "Bergamo, Lombardia, Italia",
  boundingbox: ["45.6655", "45.7313", "9.6170", "9.7230"] as [string, string, string, string],
  lat: "45.6944",
  lon: "9.6698",
  category: "boundary",
  type: "administrative",
};

function reply(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

/** A geocoder on a fake clock: `sleep` advances time instead of waiting. */
function harness(
  fetchImpl?: FetchLike,
  opts: Partial<ConstructorParameters<typeof Geocoder>[0]> = {}
) {
  let now = 10_000;
  const sleeps: number[] = [];
  const callTimes: number[] = [];
  const fetch = vi.fn<FetchLike>(async (url, init) => {
    callTimes.push(now);
    return (fetchImpl ?? (async () => reply([BERGAMO])))(url, init);
  });
  const geocoder = new Geocoder({
    baseUrl: "https://nominatim.example.org",
    userAgent: "moveet-test/1",
    fetch,
    now: () => now,
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
    },
    ...opts,
  });
  return { geocoder, fetch, sleeps, callTimes, advance: (ms: number) => (now += ms) };
}

describe("toGeocodeResult", () => {
  it("reorders Nominatim's [south, north, west, east] into [west, south, east, north]", () => {
    expect(toGeocodeResult(BERGAMO)).toEqual({
      name: "Bergamo, Lombardia, Italia",
      bbox: [9.617, 45.6655, 9.723, 45.7313],
      center: [9.6698, 45.6944],
      type: "boundary/administrative",
    });
  });

  it("drops places without a usable bbox or position", () => {
    expect(toGeocodeResult({ ...BERGAMO, boundingbox: undefined })).toBeNull();
    expect(toGeocodeResult({ ...BERGAMO, lat: "x" })).toBeNull();
  });
});

describe("Geocoder", () => {
  it("queries /search with the project User-Agent", async () => {
    const { geocoder, fetch } = harness();
    const results = await geocoder.search("Bergamo");
    expect(results).toHaveLength(1);
    const [url, init] = fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://nominatim.example.org/search");
    expect(parsed.searchParams.get("q")).toBe("Bergamo");
    expect(parsed.searchParams.get("format")).toBe("jsonv2");
    expect(init?.headers?.["User-Agent"]).toBe("moveet-test/1");
  });

  it("serves repeats from the cache (case and whitespace insensitive)", async () => {
    const { geocoder, fetch } = harness();
    await geocoder.search("Bergamo");
    await geocoder.search("  bergamo ");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("expires cache entries after the TTL", async () => {
    const { geocoder, fetch, advance } = harness(undefined, { cacheTtlMs: 1000 });
    await geocoder.search("Bergamo");
    advance(5000);
    await geocoder.search("Bergamo");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("evicts the least recently used entry beyond the cache size", async () => {
    const { geocoder, fetch } = harness(undefined, { cacheSize: 2 });
    await geocoder.search("a1");
    await geocoder.search("b1");
    await geocoder.search("a1"); // a1 is now the most recent
    await geocoder.search("c1"); // evicts b1
    await geocoder.search("a1");
    expect(fetch).toHaveBeenCalledTimes(3);
    await geocoder.search("b1");
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("spaces upstream requests at least a second apart", async () => {
    const { geocoder, callTimes } = harness();
    await Promise.all([geocoder.search("one"), geocoder.search("two"), geocoder.search("three")]);
    expect(callTimes).toHaveLength(3);
    expect(callTimes[1] - callTimes[0]).toBeGreaterThanOrEqual(1000);
    expect(callTimes[2] - callTimes[1]).toBeGreaterThanOrEqual(1000);
  });

  it("shares one upstream request between identical concurrent searches", async () => {
    const { geocoder, fetch } = harness();
    await Promise.all([geocoder.search("Bergamo"), geocoder.search("bergamo")]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses with GeocodeRateLimitError once the queue is full", async () => {
    const { geocoder } = harness(undefined, { maxQueue: 2 });
    const queued = [geocoder.search("q1"), geocoder.search("q2")];
    await expect(geocoder.search("q3")).rejects.toBeInstanceOf(GeocodeRateLimitError);
    await Promise.all(queued);
    // Room again once the queue drained.
    await expect(geocoder.search("q4")).resolves.toHaveLength(1);
  });

  it("maps an upstream 429 to GeocodeRateLimitError and other failures to GeocodeUpstreamError", async () => {
    await expect(harness(async () => reply([], 429)).geocoder.search("x1")).rejects.toBeInstanceOf(
      GeocodeRateLimitError
    );
    await expect(harness(async () => reply([], 503)).geocoder.search("x2")).rejects.toBeInstanceOf(
      GeocodeUpstreamError
    );
    await expect(
      harness(async () => {
        throw new Error("ECONNRESET");
      }).geocoder.search("x3")
    ).rejects.toThrow(/ECONNRESET/);
    await expect(harness(async () => reply({ nope: 1 })).geocoder.search("x4")).rejects.toThrow(
      /unexpected response/
    );
  });

  it("does not cache failures, and a failure does not block the next search", async () => {
    let fail = true;
    const { geocoder, fetch } = harness(async () => (fail ? reply([], 500) : reply([BERGAMO])));
    await expect(geocoder.search("Bergamo")).rejects.toBeInstanceOf(GeocodeUpstreamError);
    fail = false;
    await expect(geocoder.search("Bergamo")).resolves.toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
