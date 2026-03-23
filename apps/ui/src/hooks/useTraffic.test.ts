import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTraffic } from "./useTraffic";
import client from "@/utils/client";
import type { TrafficEdge } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getTraffic: vi.fn(),
    onTraffic: vi.fn(),
    offTraffic: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getTraffic).mockResolvedValue({ data: undefined });
  vi.mocked(client.onTraffic).mockImplementation(() => {});
});

function createTrafficEdge(overrides: Partial<TrafficEdge> = {}): TrafficEdge {
  return {
    edgeId: "edge-1",
    congestion: 0.8,
    coordinates: [
      [36.82, -1.29],
      [36.83, -1.3],
    ],
    highway: "primary",
    streetId: "street-1",
    ...overrides,
  };
}

describe("useTraffic", () => {
  it("initializes with empty edges array", () => {
    const { result } = renderHook(() => useTraffic());
    expect(result.current.edges).toEqual([]);
    expect(result.current.loading).toBe(true);
  });

  it("fetches traffic on mount and sets edges", async () => {
    const edge1 = createTrafficEdge({ edgeId: "e1", congestion: 0.5 });
    const edge2 = createTrafficEdge({ edgeId: "e2", congestion: 1.0 });

    vi.mocked(client.getTraffic).mockResolvedValue({ data: [edge1, edge2] });

    const { result } = renderHook(() => useTraffic());

    await vi.waitFor(() => {
      expect(result.current.edges).toHaveLength(2);
    });

    expect(result.current.edges).toEqual([edge1, edge2]);
    expect(result.current.loading).toBe(false);
  });

  it("subscribes to WS traffic updates and replaces edges", async () => {
    const { result } = renderHook(() => useTraffic());

    const onTrafficMock = vi.mocked(client.onTraffic);
    expect(onTrafficMock).toHaveBeenCalledOnce();

    const handler = onTrafficMock.mock.calls[0][0];
    const wsEdge = createTrafficEdge({ edgeId: "ws-1", congestion: 0.3 });

    act(() => {
      handler([wsEdge]);
    });

    expect(result.current.edges).toEqual([wsEdge]);
  });

  it("handles fetch returning no data gracefully", async () => {
    vi.mocked(client.getTraffic).mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => useTraffic());

    await vi.waitFor(() => {
      expect(client.getTraffic).toHaveBeenCalledOnce();
    });

    expect(result.current.edges).toEqual([]);
  });

  it("WS update replaces previous fetch data entirely", async () => {
    const fetchEdge = createTrafficEdge({ edgeId: "fetch-1" });
    vi.mocked(client.getTraffic).mockResolvedValue({ data: [fetchEdge] });

    const { result } = renderHook(() => useTraffic());

    await vi.waitFor(() => {
      expect(result.current.edges).toHaveLength(1);
    });

    const handler = vi.mocked(client.onTraffic).mock.calls[0][0];
    const wsEdge = createTrafficEdge({ edgeId: "ws-1" });

    act(() => {
      handler([wsEdge]);
    });

    expect(result.current.edges).toHaveLength(1);
    expect(result.current.edges[0].edgeId).toBe("ws-1");
  });

  it("logs warning when fetch returns error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(client.getTraffic).mockResolvedValue({
      data: undefined,
      error: "Server error",
    });

    renderHook(() => useTraffic());

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("useTraffic: failed to fetch traffic", "Server error");
    });

    warnSpy.mockRestore();
  });
});
