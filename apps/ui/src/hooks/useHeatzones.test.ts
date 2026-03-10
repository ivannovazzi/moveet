import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { useHeatzones } from "./useHeatzones";
import { ClientDataContext } from "@/data/context";
import { DEFAULT_START_OPTIONS } from "@/data/constants";
import { createHeatzone } from "@/test/mocks/types";
import client from "@/utils/client";
import type { Heatzone } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getHeatzones: vi.fn(),
    onHeatzones: vi.fn(),
  },
}));

function createWrapper(
  heatzones: Heatzone[],
  setHeatzones: React.Dispatch<React.SetStateAction<Heatzone[]>>
) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(ClientDataContext.Provider, {
      value: {
        options: DEFAULT_START_OPTIONS,
        roads: [],
        pois: [],
        directions: new Map(),
        heatzones,
        network: { type: "FeatureCollection", features: [] },
        setOptions: () => {},
        setRoads: () => {},
        setPOIs: () => {},
        setDirections: () => {},
        setHeatzones,
        setNetwork: () => {},
      },
      children,
    });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getHeatzones).mockResolvedValue({ data: undefined });
  vi.mocked(client.onHeatzones).mockImplementation(() => {});
});

describe("useHeatzones", () => {
  it("returns initial empty heatzones array", () => {
    const setHeatzones = vi.fn();
    const { result } = renderHook(() => useHeatzones(), {
      wrapper: createWrapper([], setHeatzones),
    });

    expect(result.current).toEqual([]);
  });

  it("fetches heatzones on mount and updates state", async () => {
    const hz1 = createHeatzone({
      properties: { id: "hz-1", intensity: 0.8, timestamp: "2026-01-01T00:00:00Z", radius: 300 },
    });
    const hz2 = createHeatzone({
      properties: { id: "hz-2", intensity: 0.3, timestamp: "2026-01-02T00:00:00Z", radius: 700 },
    });

    vi.mocked(client.getHeatzones).mockResolvedValue({ data: [hz1, hz2] });

    const setHeatzones = vi.fn();
    renderHook(() => useHeatzones(), {
      wrapper: createWrapper([], setHeatzones),
    });

    await vi.waitFor(() => {
      expect(setHeatzones).toHaveBeenCalledWith([hz1, hz2]);
    });
  });

  it("handles WS heatzone updates via onHeatzones callback", () => {
    const setHeatzones = vi.fn();
    renderHook(() => useHeatzones(), {
      wrapper: createWrapper([], setHeatzones),
    });

    const onHeatzonesMock = vi.mocked(client.onHeatzones);
    expect(onHeatzonesMock).toHaveBeenCalledOnce();

    const handler = onHeatzonesMock.mock.calls[0][0];
    const wsHeatzone = createHeatzone({
      properties: { id: "ws-hz-1", intensity: 0.9, timestamp: "2026-02-01T00:00:00Z", radius: 400 },
    });

    act(() => {
      handler([wsHeatzone]);
    });

    expect(setHeatzones).toHaveBeenCalledWith([wsHeatzone]);
  });

  it("handles fetch returning no data gracefully", async () => {
    vi.mocked(client.getHeatzones).mockResolvedValue({ data: undefined });

    const setHeatzones = vi.fn();
    renderHook(() => useHeatzones(), {
      wrapper: createWrapper([], setHeatzones),
    });

    // Let the promise resolve
    await vi.waitFor(() => {
      expect(client.getHeatzones).toHaveBeenCalledOnce();
    });

    // setHeatzones should not have been called since data is undefined
    expect(setHeatzones).not.toHaveBeenCalled();
  });
});
