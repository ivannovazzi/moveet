import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { usePois } from "./usePois";
import client from "@/utils/client";
import { ClientDataContext } from "@/data/context";
import { DEFAULT_START_OPTIONS } from "@/data/constants";
import { createPOI } from "@/test/mocks/types";
import type { POI } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getPois: vi.fn(),
  },
}));

function createWrapper(setPOIs: React.Dispatch<React.SetStateAction<POI[]>> = vi.fn()) {
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
        setRoads: vi.fn(),
        setPOIs,
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

describe("usePois", () => {
  it("returns initial empty pois array", () => {
    vi.mocked(client.getPois).mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => usePois(), { wrapper: createWrapper() });

    expect(result.current.pois).toEqual([]);
  });

  it("fetches POIs on mount and populates state", async () => {
    const poi1 = createPOI({ id: "poi-1", name: "City Mall" });
    const poi2 = createPOI({ id: "poi-2", name: "Bus Station" });

    const setPOIs = vi.fn();
    vi.mocked(client.getPois).mockResolvedValue({ data: [poi1, poi2] });

    renderHook(() => usePois(), { wrapper: createWrapper(setPOIs) });

    await waitFor(() => {
      expect(setPOIs).toHaveBeenCalledWith([poi1, poi2]);
    });

    expect(client.getPois).toHaveBeenCalledOnce();
  });

  it("handles fetch returning no data", async () => {
    const setPOIs = vi.fn();
    vi.mocked(client.getPois).mockResolvedValue({ data: undefined });

    renderHook(() => usePois(), { wrapper: createWrapper(setPOIs) });

    await waitFor(() => {
      expect(client.getPois).toHaveBeenCalledOnce();
    });

    expect(setPOIs).not.toHaveBeenCalled();
  });
});
