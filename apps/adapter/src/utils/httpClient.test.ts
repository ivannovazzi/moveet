import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { httpFetch, HttpClientError, HttpTimeoutError } from "./httpClient";

describe("httpClient", () => {
  const originalFetch = globalThis.fetch;

  let instantSleep: ReturnType<typeof vi.fn<(ms: number) => Promise<void>>>;

  beforeEach(() => {
    vi.restoreAllMocks();
    instantSleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** Helper: mock fetch to return a successful response. */
  function mockOk(body: unknown = { ok: true }) {
    const mockFn = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), { status: 200, statusText: "OK" })
    );
    globalThis.fetch = mockFn;
    return mockFn;
  }

  // ── (a) Successful request ──────────────────────────────────────────

  describe("successful request", () => {
    it("returns the response on a 200", async () => {
      mockOk({ data: 1 });

      const res = await httpFetch("http://example.com/api", {}, { sleep: instantSleep });
      expect(res.ok).toBe(true);
      const json = await res.json();
      expect(json).toEqual({ data: 1 });
    });

    it("forwards request options (method, headers, body)", async () => {
      const mockFn = mockOk();

      await httpFetch(
        "http://example.com/api",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: 1 }),
        },
        { sleep: instantSleep }
      );

      expect(mockFn).toHaveBeenCalledOnce();
      expect(mockFn).toHaveBeenCalledWith(
        "http://example.com/api",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ x: 1 }),
        })
      );
    });

    it("does not retry on success", async () => {
      const mockFn = mockOk();

      await httpFetch("http://example.com/api", {}, { maxRetries: 3, sleep: instantSleep });
      expect(mockFn).toHaveBeenCalledOnce();
      expect(instantSleep).not.toHaveBeenCalled();
    });
  });

  // ── (b) Timeout ─────────────────────────────────────────────────────

  describe("timeout", () => {
    it("throws HttpTimeoutError when request exceeds timeout", async () => {
      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          })
      );

      await expect(
        httpFetch("http://slow.example.com", {}, { timeoutMs: 50, maxRetries: 1 })
      ).rejects.toThrow(HttpTimeoutError);
    });

    it("HttpTimeoutError includes the url and timeout value", async () => {
      globalThis.fetch = vi.fn().mockImplementation(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => {
              reject(new DOMException("The operation was aborted.", "AbortError"));
            });
          })
      );

      try {
        await httpFetch("http://slow.example.com/path", {}, { timeoutMs: 50, maxRetries: 1 });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HttpTimeoutError);
        expect((err as HttpTimeoutError).message).toContain("slow.example.com/path");
        expect((err as HttpTimeoutError).message).toContain("50ms");
      }
    });
  });

  // ── (c) Retry on failure with backoff ───────────────────────────────

  describe("retry with backoff", () => {
    it("retries on 503 and eventually succeeds", async () => {
      const mockFn = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 503, statusText: "Service Unavailable" }))
        .mockResolvedValueOnce(new Response("", { status: 503, statusText: "Service Unavailable" }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      globalThis.fetch = mockFn;

      const res = await httpFetch("http://example.com/api", {}, {
        maxRetries: 3,
        sleep: instantSleep,
      });

      expect(res.ok).toBe(true);
      expect(mockFn).toHaveBeenCalledTimes(3);
      expect(instantSleep).toHaveBeenCalledTimes(2);
    });

    it("retries on network errors (TypeError) and eventually succeeds", async () => {
      const mockFn = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("fetch failed"))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      globalThis.fetch = mockFn;

      const res = await httpFetch("http://example.com/api", {}, {
        maxRetries: 3,
        sleep: instantSleep,
      });

      expect(res.ok).toBe(true);
      expect(mockFn).toHaveBeenCalledTimes(2);
    });

    it("calls sleep between retries with increasing values", async () => {
      const sleepFn = vi.fn().mockResolvedValue(undefined);
      // Use a fixed random to make backoff predictable
      vi.spyOn(Math, "random").mockReturnValue(1);

      const mockFn = vi
        .fn()
        .mockResolvedValueOnce(new Response("", { status: 500, statusText: "Internal Server Error" }))
        .mockResolvedValueOnce(new Response("", { status: 500, statusText: "Internal Server Error" }))
        .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      globalThis.fetch = mockFn;

      await httpFetch("http://example.com/api", {}, {
        maxRetries: 3,
        baseDelayMs: 100,
        maxDelayMs: 10000,
        sleep: sleepFn,
      });

      // attempt 1 retry: delay = random(1) * min(10000, 100 * 2^0) = 100
      // attempt 2 retry: delay = random(1) * min(10000, 100 * 2^1) = 200
      expect(sleepFn).toHaveBeenCalledTimes(2);
      expect(sleepFn).toHaveBeenNthCalledWith(1, 100);
      expect(sleepFn).toHaveBeenNthCalledWith(2, 200);
    });

    it("does not retry on non-retryable status codes (e.g. 404)", async () => {
      const mockFn = vi.fn().mockResolvedValue(
        new Response("", { status: 404, statusText: "Not Found" })
      );
      globalThis.fetch = mockFn;

      await expect(
        httpFetch("http://example.com/api", {}, { maxRetries: 3, sleep: instantSleep })
      ).rejects.toThrow(HttpClientError);

      expect(mockFn).toHaveBeenCalledOnce();
      expect(instantSleep).not.toHaveBeenCalled();
    });

    it("retries on retryable status codes (429, 500, 502, 503, 504)", async () => {
      for (const status of [429, 500, 502, 503, 504]) {
        vi.restoreAllMocks();
        const sleep = vi.fn().mockResolvedValue(undefined);

        const mockFn = vi
          .fn()
          .mockResolvedValueOnce(new Response("", { status, statusText: "Error" }))
          .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
        globalThis.fetch = mockFn;

        const res = await httpFetch("http://example.com/api", {}, { maxRetries: 2, sleep });
        expect(res.ok).toBe(true);
        expect(mockFn).toHaveBeenCalledTimes(2);
      }
    });
  });

  // ── (d) Max retries exceeded ────────────────────────────────────────

  describe("max retries exceeded", () => {
    it("throws HttpClientError after exhausting all retries on 503", async () => {
      const mockFn = vi.fn().mockResolvedValue(
        new Response("", { status: 503, statusText: "Service Unavailable" })
      );
      globalThis.fetch = mockFn;

      await expect(
        httpFetch("http://example.com/api", {}, { maxRetries: 3, sleep: instantSleep })
      ).rejects.toThrow(HttpClientError);

      expect(mockFn).toHaveBeenCalledTimes(3);
    });

    it("thrown error contains status code", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("", { status: 502, statusText: "Bad Gateway" })
      );

      try {
        await httpFetch("http://example.com/api", {}, { maxRetries: 2, sleep: instantSleep });
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(HttpClientError);
        expect((err as HttpClientError).statusCode).toBe(502);
        expect((err as HttpClientError).message).toContain("502");
      }
    });

    it("throws after max retries on persistent network error", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

      await expect(
        httpFetch("http://example.com/api", {}, { maxRetries: 3, sleep: instantSleep })
      ).rejects.toThrow(HttpClientError);

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("maxRetries=1 means no retry", async () => {
      const mockFn = vi.fn().mockResolvedValue(
        new Response("", { status: 500, statusText: "Internal Server Error" })
      );
      globalThis.fetch = mockFn;

      await expect(
        httpFetch("http://example.com/api", {}, { maxRetries: 1, sleep: instantSleep })
      ).rejects.toThrow(HttpClientError);

      expect(mockFn).toHaveBeenCalledOnce();
      expect(instantSleep).not.toHaveBeenCalled();
    });
  });
});
