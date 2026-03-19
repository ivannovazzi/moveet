import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import React, { useState } from "react";
import { useNetwork } from "./useNetwork";
import { NetworkContext } from "@/data/context";
import { createRoadNetwork } from "@/test/mocks/types";
import client from "@/utils/client";
import type { RoadNetwork } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getNetwork: vi.fn(),
  },
}));

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    const [network, setNetwork] = useState<RoadNetwork>({
      type: "FeatureCollection",
      features: [],
    });
    return React.createElement(NetworkContext.Provider, {
      value: { network, setNetwork },
      children,
    });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getNetwork).mockResolvedValue({ data: undefined });
});

describe("useNetwork", () => {
  it("initial loading state is true", () => {
    const { result } = renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    });
    expect(result.current.loading).toBe(true);
  });

  it("sets loading to false after successful fetch", async () => {
    const network = createRoadNetwork();
    vi.mocked(client.getNetwork).mockResolvedValue({ data: network });

    const { result } = renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    });

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("sets loading to false after failed fetch", async () => {
    vi.mocked(client.getNetwork).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    });

    await vi.waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
  });

  it("sets network data on success", async () => {
    const network = createRoadNetwork({
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [36.82, -1.29],
              [36.83, -1.3],
            ],
          },
          properties: { id: "road-1", highway: "primary" },
        },
      ],
    });
    vi.mocked(client.getNetwork).mockResolvedValue({ data: network });

    const { result } = renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    });

    await vi.waitFor(() => {
      expect(result.current.network.features).toHaveLength(1);
    });

    expect(result.current.network.features[0].properties.id).toBe("road-1");
  });

  it("logs warning on response.error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(client.getNetwork).mockResolvedValue({
      data: undefined,
      error: "Server error",
    });

    renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    });

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith("useNetwork: failed to fetch network", "Server error");
    });

    warnSpy.mockRestore();
  });

  it("logs warning on network exception (.catch)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(client.getNetwork).mockRejectedValue(new Error("Connection refused"));

    renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    });

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        "useNetwork: failed to fetch network",
        "Connection refused"
      );
    });

    warnSpy.mockRestore();
  });
});
