import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchUntil } from "./fetchWithRetry";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchUntil", () => {
  it("returns result on first try", async () => {
    const fn = vi.fn().mockResolvedValue("data");

    const promise = fetchUntil(fn);
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result).toBe("data");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("returns null when fn always returns null", async () => {
    const fn = vi.fn().mockResolvedValue(null);

    const promise = fetchUntil(fn, { maxRetries: 2 });
    // 3 attempts (0,1,2) with delays: 1000 + 2000 + 4000 = 7000ms
    await vi.advanceTimersByTimeAsync(7000);
    const result = await promise;

    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("returns null when fn always returns undefined", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);

    const promise = fetchUntil(fn, { maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(7000);
    const result = await promise;

    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("retries on error and returns value on next success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue("recovered");

    const promise = fetchUntil(fn);
    // Attempt 0 throws, delay 1000ms, then attempt 1 succeeds
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(result).toBe("recovered");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("returns null when aborted via signal", async () => {
    const controller = new AbortController();
    const fn = vi.fn().mockResolvedValue(null);

    const promise = fetchUntil(fn, { signal: controller.signal, maxRetries: 6 });
    // Let first attempt run and enter delay
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result).toBeNull();
  });

  it("respects custom maxRetries", async () => {
    const fn = vi.fn().mockResolvedValue(null);

    const promise = fetchUntil(fn, { maxRetries: 2 });
    await vi.advanceTimersByTimeAsync(7000);
    const result = await promise;

    expect(result).toBeNull();
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("returns first non-null result after retries", async () => {
    const fn = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue("found");

    const promise = fetchUntil(fn);
    // Attempt 0: null, delay 1000ms; Attempt 1: null, delay 2000ms; Attempt 2: "found"
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;

    expect(result).toBe("found");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
