import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { useRoads } from "./useRoads";
import client from "@/utils/client";
import { RoadsContext } from "@/data/context";
import { createRoad } from "@/test/mocks/types";
import type { Road } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getRoads: vi.fn(),
  },
}));

function createWrapper(setRoads: React.Dispatch<React.SetStateAction<Road[]>> = vi.fn()) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(RoadsContext.Provider, {
      value: {
        roads: [],
        setRoads,
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

describe("useRoads loading state", () => {
  it("initial loading state is true", () => {
    vi.mocked(client.getRoads).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useRoads(), { wrapper: createWrapper() });

    expect(result.current.loading).toBe(true);
  });

  it("loading becomes false after successful fetch", async () => {
    const namedRoad = createRoad({ name: "Moi Avenue" });
    vi.mocked(client.getRoads).mockResolvedValue({ data: [namedRoad] });

    const { result } = renderHook(() => useRoads(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("loading becomes false after failed fetch", async () => {
    vi.mocked(client.getRoads).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useRoads(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });
});
