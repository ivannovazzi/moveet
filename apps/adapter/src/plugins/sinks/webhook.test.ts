import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebhookSink } from "./webhook";

describe("WebhookSink health check", () => {
  let sink: WebhookSink;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    sink = new WebhookSink();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reports unhealthy when not connected", async () => {
    const result = await sink.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.message).toBeDefined();
  });

  it("reports healthy when URL is reachable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    await sink.connect({ url: "http://example.com/hook" });

    const result = await sink.healthCheck();

    expect(result.healthy).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it("reports unhealthy when URL is unreachable", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await sink.connect({ url: "http://unreachable.local/hook" });

    const result = await sink.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("ECONNREFUSED");
  });
});

describe("WebhookSink publishUpdates timeout", () => {
  let sink: WebhookSink;
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    vi.useFakeTimers();
    sink = new WebhookSink();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("aborts publishUpdates when the request exceeds the timeout", async () => {
    globalThis.fetch = vi.fn().mockImplementation(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        })
    );

    await sink.connect({ url: "http://slow.example.com/hook" });
    const promise = sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }]);

    vi.advanceTimersByTime(10000);

    await expect(promise).rejects.toThrow("aborted");
  });

  it("passes an AbortSignal to fetch during publishUpdates", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.useRealTimers();

    await sink.connect({ url: "http://example.com/hook" });
    await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }]);

    expect(globalThis.fetch).toHaveBeenCalledWith(
      "http://example.com/hook",
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
