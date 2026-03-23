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

// Single-attempt mock — retry logic is tested separately in fetchWithRetry.test.ts
vi.mock("@/utils/fetchWithRetry", () => ({
  fetchUntil: vi.fn(async (fn: () => Promise<unknown>) => {
    try {
      return await fn();
    } catch {
      return null;
    }
  }),
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

  it("keeps loading true when fetch returns no data", async () => {
    vi.mocked(client.getNetwork).mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => useNetwork(), {
      wrapper: createWrapper(),
    });

    // Allow the fetch promise to settle
    await vi.waitFor(() => {
      expect(client.getNetwork).toHaveBeenCalled();
    });

    // Loading stays true because no data was received
    expect(result.current.loading).toBe(true);
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
});
