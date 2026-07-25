import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useVersionCheck } from "./useVersionCheck";
import { NEW_VERSION_MESSAGE, VERSION_POLL_INTERVAL_MS } from "@/lib/versionCheck";
import { toast } from "@/lib/toast";

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

const infoMock = vi.mocked(toast.info);

/** A fetch stub that always answers version.json with `buildId`. */
function deployed(buildId: string) {
  return vi.fn(async () => ({
    ok: true,
    text: async () => JSON.stringify({ buildId }),
  })) as unknown as typeof fetch;
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  infoMock.mockClear();
  vi.stubEnv("VITE_BUILD_ID", "build-1");
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("useVersionCheck", () => {
  it("is a no-op in dev, where HMR already handles reloads", async () => {
    // Vitest runs with import.meta.env.DEV === true, so the default enablement
    // must switch the whole thing off — no polling, no toast.
    expect(import.meta.env.DEV).toBe(true);
    const fetchImpl = deployed("build-2");
    renderHook(() => useVersionCheck({ fetchImpl }));

    await vi.advanceTimersByTimeAsync(VERSION_POLL_INTERVAL_MS * 3);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(infoMock).not.toHaveBeenCalled();
  });

  it("polls by default once DEV is false", async () => {
    vi.stubEnv("DEV", false);
    const fetchImpl = deployed("build-1");
    renderHook(() => useVersionCheck({ fetchImpl }));

    await vi.advanceTimersByTimeAsync(VERSION_POLL_INTERVAL_MS);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not toast while the served build matches", async () => {
    const fetchImpl = deployed("build-1");
    renderHook(() => useVersionCheck({ enabled: true, intervalMs: 1000, fetchImpl }));

    await vi.advanceTimersByTimeAsync(3000);

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(infoMock).not.toHaveBeenCalled();
  });

  it("toasts with a reload action when the served build differs", async () => {
    const fetchImpl = deployed("build-2");
    renderHook(() => useVersionCheck({ enabled: true, intervalMs: 1000, fetchImpl }));

    await vi.advanceTimersByTimeAsync(1000);

    expect(infoMock).toHaveBeenCalledTimes(1);
    const [message, options] = infoMock.mock.calls[0];
    expect(message).toBe(NEW_VERSION_MESSAGE);
    expect(options?.action?.label).toBe("Reload");
    expect(options?.duration).toBe(Number.POSITIVE_INFINITY);
  });

  it("only nags once and stops polling afterwards", async () => {
    const fetchImpl = deployed("build-2");
    renderHook(() => useVersionCheck({ enabled: true, intervalMs: 1000, fetchImpl }));

    await vi.advanceTimersByTimeAsync(5000);

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stays quiet when the bundle carries no build stamp", async () => {
    vi.stubEnv("VITE_BUILD_ID", "");
    const fetchImpl = deployed("build-2");
    renderHook(() => useVersionCheck({ enabled: true, intervalMs: 1000, fetchImpl }));

    await vi.advanceTimersByTimeAsync(5000);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(infoMock).not.toHaveBeenCalled();
  });

  it("stays quiet when version.json cannot be read", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      text: async () => "<!doctype html>",
    })) as unknown as typeof fetch;
    renderHook(() => useVersionCheck({ enabled: true, intervalMs: 1000, fetchImpl }));

    await vi.advanceTimersByTimeAsync(3000);

    expect(infoMock).not.toHaveBeenCalled();
  });

  it("pauses while the tab is hidden and rechecks immediately on return", async () => {
    const fetchImpl = deployed("build-1");
    renderHook(() => useVersionCheck({ enabled: true, intervalMs: 1000, fetchImpl }));

    setHidden(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).not.toHaveBeenCalled();

    setHidden(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("stops polling on unmount", async () => {
    const fetchImpl = deployed("build-1");
    const { unmount } = renderHook(() =>
      useVersionCheck({ enabled: true, intervalMs: 1000, fetchImpl })
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    unmount();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
