import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useHeatzoneEditor, DEFAULT_HEATZONE_INTENSITY } from "./useHeatzoneEditor";
import client from "@/utils/client";
import type { Position } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    createHeatzone: vi.fn().mockResolvedValue({ data: undefined }),
    updateHeatzone: vi.fn().mockResolvedValue({ data: undefined }),
    deleteHeatzone: vi.fn().mockResolvedValue({ data: undefined }),
    clearHeatzones: vi.fn().mockResolvedValue({ data: undefined }),
    seedHeatzones: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  toErrorMessage: (_e: unknown, f: string) => f,
}));

const triangle: Position[] = [
  [36.8, -1.3],
  [36.81, -1.3],
  [36.81, -1.31],
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useHeatzoneEditor - state machine", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    expect(result.current.mode).toBe("idle");
    expect(result.current.selectedId).toBeNull();
    expect(result.current.isDrawing).toBe(false);
  });

  it("enters and exits draw mode", () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => result.current.startDraw());
    expect(result.current.mode).toBe("draw");
    expect(result.current.isDrawing).toBe(true);
    act(() => result.current.stopDraw());
    expect(result.current.mode).toBe("idle");
    expect(result.current.isDrawing).toBe(false);
  });

  it("selecting a zone moves to selected mode and clears drawing", () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => result.current.startDraw());
    act(() => result.current.select("hz-1"));
    expect(result.current.mode).toBe("selected");
    expect(result.current.selectedId).toBe("hz-1");
    expect(result.current.isDrawing).toBe(false);
  });

  it("starting draw clears the current selection", () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => result.current.select("hz-1"));
    act(() => result.current.startDraw());
    expect(result.current.selectedId).toBeNull();
    expect(result.current.mode).toBe("draw");
  });

  it("deselect returns to idle", () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => result.current.select("hz-1"));
    act(() => result.current.deselect());
    expect(result.current.mode).toBe("idle");
    expect(result.current.selectedId).toBeNull();
  });
});

describe("useHeatzoneEditor - mutations", () => {
  it("createFromLasso posts a closed ring with the default intensity", async () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    await act(async () => {
      await result.current.createFromLasso(triangle);
    });
    expect(client.createHeatzone).toHaveBeenCalledTimes(1);
    const body = vi.mocked(client.createHeatzone).mock.calls[0][0];
    expect(body.intensity).toBe(DEFAULT_HEATZONE_INTENSITY);
    expect(body.geometry.type).toBe("Polygon");
    // ring is closed: first point repeated at the end
    const ring = body.geometry.coordinates;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(ring.length).toBe(triangle.length + 1);
  });

  it("createFromLasso rejects a degenerate (<3 point) stroke", async () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    await act(async () => {
      await result.current.createFromLasso([
        [36.8, -1.3],
        [36.81, -1.3],
      ]);
    });
    expect(client.createHeatzone).not.toHaveBeenCalled();
  });

  it("createFromLasso rejects a zero-area stroke", async () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    await act(async () => {
      await result.current.createFromLasso([
        [36.8, -1.3],
        [36.81, -1.3],
        [36.82, -1.3],
      ]);
    });
    expect(client.createHeatzone).not.toHaveBeenCalled();
  });

  it("commitGeometry patches the zone geometry and clears the draft", async () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => result.current.setDraft("hz-1", triangle));
    expect(result.current.draft).not.toBeNull();
    await act(async () => {
      await result.current.commitGeometry("hz-1", triangle);
    });
    expect(client.updateHeatzone).toHaveBeenCalledWith(
      "hz-1",
      expect.objectContaining({ geometry: expect.objectContaining({ type: "Polygon" }) })
    );
    expect(result.current.draft).toBeNull();
  });

  it("remove deletes the zone and clears its selection", async () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => result.current.select("hz-1"));
    await act(async () => {
      await result.current.remove("hz-1");
    });
    expect(client.deleteHeatzone).toHaveBeenCalledWith("hz-1");
    expect(result.current.selectedId).toBeNull();
  });

  it("remove clears selection without an error toast on a clean (204) delete", async () => {
    const { toast } = await import("@/lib/toast");
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => result.current.select("hz-1"));
    await act(async () => {
      await result.current.remove("hz-1");
    });
    expect(result.current.selectedId).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("clearAll clears every zone and deselects", async () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => result.current.select("hz-1"));
    await act(async () => {
      await result.current.clearAll();
    });
    expect(client.clearHeatzones).toHaveBeenCalledTimes(1);
    expect(result.current.selectedId).toBeNull();
  });

  it("clearAll toasts success on a clean (204) delete", async () => {
    const { toast } = await import("@/lib/toast");
    const { result } = renderHook(() => useHeatzoneEditor());
    await act(async () => {
      await result.current.clearAll();
    });
    expect(toast.success).toHaveBeenCalledWith("Cleared all zones");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("seed forwards the count", async () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    await act(async () => {
      await result.current.seed(7);
    });
    expect(client.seedHeatzones).toHaveBeenCalledWith({ count: 7 });
  });

  it("bumps seedNonce and toasts the total on a successful seed", async () => {
    const { toast } = await import("@/lib/toast");
    vi.mocked(client.seedHeatzones).mockResolvedValueOnce({
      data: [{}, {}, {}],
    } as never);
    const { result } = renderHook(() => useHeatzoneEditor());
    expect(result.current.seedNonce).toBe(0);
    await act(async () => {
      await result.current.seed();
    });
    expect(result.current.seedNonce).toBe(1);
    expect(toast.success).toHaveBeenCalledWith("Seeded random zones (3 total)");
  });

  it("does not bump seedNonce or toast success when seeding fails", async () => {
    const { toast } = await import("@/lib/toast");
    vi.mocked(client.seedHeatzones).mockResolvedValueOnce({ error: "boom" } as never);
    const { result } = renderHook(() => useHeatzoneEditor());
    await act(async () => {
      await result.current.seed();
    });
    expect(result.current.seedNonce).toBe(0);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
  });
});

describe("useHeatzoneEditor - intensity debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("coalesces rapid intensity changes into a single PATCH with the last value", () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => {
      result.current.setIntensity("hz-1", 0.3);
      result.current.setIntensity("hz-1", 0.6);
      result.current.setIntensity("hz-1", 0.9);
    });
    expect(client.updateHeatzone).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(client.updateHeatzone).toHaveBeenCalledTimes(1);
    expect(client.updateHeatzone).toHaveBeenCalledWith("hz-1", { intensity: 0.9 });
  });

  it("flushes the pending PATCH for zone A immediately when a different zone B is edited", () => {
    const { result } = renderHook(() => useHeatzoneEditor());
    act(() => {
      result.current.setIntensity("hz-A", 0.3);
    });
    // Nothing sent yet - A is only armed on the debounce timer.
    expect(client.updateHeatzone).not.toHaveBeenCalled();

    act(() => {
      result.current.setIntensity("hz-B", 0.8);
    });
    // Switching to B flushes A's pending change right away (no timer advance).
    expect(client.updateHeatzone).toHaveBeenCalledTimes(1);
    expect(client.updateHeatzone).toHaveBeenCalledWith("hz-A", { intensity: 0.3 });

    // B still lands after its own debounce window.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(client.updateHeatzone).toHaveBeenCalledTimes(2);
    expect(client.updateHeatzone).toHaveBeenCalledWith("hz-B", { intensity: 0.8 });
  });
});
