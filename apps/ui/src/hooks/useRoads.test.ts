import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { useRoads } from "./useRoads";
import client from "@/utils/client";
import { ClientDataContext } from "@/data/context";
import { DEFAULT_START_OPTIONS } from "@/data/constants";
import { createRoad } from "@/test/mocks/types";
import type { Road } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getRoads: vi.fn(),
  },
}));

function createWrapper(setRoads: React.Dispatch<React.SetStateAction<Road[]>> = vi.fn()) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(ClientDataContext.Provider, {
      value: {
        options: DEFAULT_START_OPTIONS,
        roads: [],
        pois: [],
        directions: new Map(),
        heatzones: [],
        network: { type: "FeatureCollection", features: [] },
        setOptions: vi.fn(),
        setRoads,
        setPOIs: vi.fn(),
        setDirections: vi.fn(),
        setHeatzones: vi.fn(),
        setNetwork: vi.fn(),
      },
      children,
    });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useRoads", () => {
  it("returns initial empty roads array", () => {
    vi.mocked(client.getRoads).mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => useRoads(), { wrapper: createWrapper() });

    expect(result.current.roads).toEqual([]);
  });

  it("fetches roads on mount and filters out unnamed roads", async () => {
    const namedRoad = createRoad({ name: "Moi Avenue" });
    const unnamedRoad = createRoad({ name: "" });
    const anotherNamedRoad = createRoad({ name: "Kenyatta Avenue" });

    const setRoads = vi.fn();
    vi.mocked(client.getRoads).mockResolvedValue({
      data: [namedRoad, unnamedRoad, anotherNamedRoad],
    });

    renderHook(() => useRoads(), { wrapper: createWrapper(setRoads) });

    await waitFor(() => {
      expect(setRoads).toHaveBeenCalledWith([namedRoad, anotherNamedRoad]);
    });

    expect(client.getRoads).toHaveBeenCalledOnce();
  });

  it("handles fetch returning no data", async () => {
    const setRoads = vi.fn();
    vi.mocked(client.getRoads).mockResolvedValue({ data: undefined });

    renderHook(() => useRoads(), { wrapper: createWrapper(setRoads) });

    await waitFor(() => {
      expect(client.getRoads).toHaveBeenCalledOnce();
    });

    expect(setRoads).not.toHaveBeenCalled();
  });
});
