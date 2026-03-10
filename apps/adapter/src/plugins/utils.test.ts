import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchWithTimeout } from "./utils";

describe("fetchWithTimeout", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("passes through successful responses", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    vi.useRealTimers();
    const response = await fetchWithTimeout("http://example.com/api");

    expect(response).toBe(mockResponse);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://example.com/api",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("aborts on timeout", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        })
    );

    const promise = fetchWithTimeout("http://slow.example.com", {}, 5000);
    vi.advanceTimersByTime(5000);

    await expect(promise).rejects.toThrow("aborted");
  });

  it("cleans up the timeout on success (no pending timers)", async () => {
    const mockResponse = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    // With fake timers active, pending timers would remain if clearTimeout wasn't called.
    // fetchWithTimeout resolves immediately (mocked), then clears the timer in finally.
    const promise = fetchWithTimeout("http://example.com/api", {}, 60000);
    // Resolve the already-resolved promise
    await promise;

    // If clearTimeout was NOT called, advancing timers would trigger abort.
    // Since the promise already resolved successfully, this just confirms no lingering side effects.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the default 10s timeout", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        })
    );

    // With default timeout (10000ms), advancing by 9999ms should NOT abort
    const promise = fetchWithTimeout("http://example.com/api");
    vi.advanceTimersByTime(9999);

    // The promise should still be pending (not rejected yet)
    const raceResult = await Promise.race([
      promise.then(() => "resolved").catch(() => "rejected"),
      Promise.resolve("pending"),
    ]);
    expect(raceResult).toBe("pending");

    // Advancing 1 more ms (total 10000) should trigger abort
    vi.advanceTimersByTime(1);
    await expect(promise).rejects.toThrow("aborted");
  });

  it("forwards request options", async () => {
    const mockResponse = new Response("ok");
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    vi.useRealTimers();
    await fetchWithTimeout("http://example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: 1 }),
    });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://example.com/api",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: 1 }),
        signal: expect.any(AbortSignal),
      })
    );
  });
});
