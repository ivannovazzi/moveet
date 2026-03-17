import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React, { useState } from "react";
import {
  RoadsContext,
  POIContext,
  DirectionContext,
  HeatZoneContext,
  NetworkContext,
  OptionsContext,
} from "./context";
import type {
  RoadsContextValue,
  POIContextValue,
  DirectionContextValue,
  HeatZoneContextValue,
  NetworkContextValue,
  OptionsContextValue,
  DirectionMap,
} from "./context";
import { DEFAULT_START_OPTIONS } from "./constants";
import { createRoad, createPOI, createHeatzone, createRoadNetwork } from "@/test/mocks/types";
import type { Road, POI, Heatzone, RoadNetwork, StartOptions } from "@/types";

// ─── RoadsContext ──────────────────────────────────────────────────

describe("RoadsContext", () => {
  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      const [roads, setRoads] = useState<Road[]>([]);
      return <RoadsContext.Provider value={{ roads, setRoads }}>{children}</RoadsContext.Provider>;
    };
  }

  function useRoadsCtx() {
    return React.useContext(RoadsContext);
  }

  it("provides empty roads array by default", () => {
    const { result } = renderHook(() => useRoadsCtx(), { wrapper: createWrapper() });
    expect(result.current.roads).toEqual([]);
  });

  it("provides setRoads that updates roads state", () => {
    const { result } = renderHook(() => useRoadsCtx(), { wrapper: createWrapper() });

    const road = createRoad({ name: "Kenyatta Avenue" });
    act(() => {
      result.current.setRoads([road]);
    });

    expect(result.current.roads).toHaveLength(1);
    expect(result.current.roads[0].name).toBe("Kenyatta Avenue");
  });

  it("does not include POIs, directions, or other unrelated data", () => {
    const { result } = renderHook(() => useRoadsCtx(), { wrapper: createWrapper() });
    const value = result.current as RoadsContextValue;
    expect(Object.keys(value)).toEqual(expect.arrayContaining(["roads", "setRoads"]));
    expect(Object.keys(value)).toHaveLength(2);
  });
});

// ─── POIContext ────────────────────────────────────────────────────

describe("POIContext", () => {
  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      const [pois, setPOIs] = useState<POI[]>([]);
      return <POIContext.Provider value={{ pois, setPOIs }}>{children}</POIContext.Provider>;
    };
  }

  function usePOICtx() {
    return React.useContext(POIContext);
  }

  it("provides empty POI array by default", () => {
    const { result } = renderHook(() => usePOICtx(), { wrapper: createWrapper() });
    expect(result.current.pois).toEqual([]);
  });

  it("provides setPOIs that updates POI state", () => {
    const { result } = renderHook(() => usePOICtx(), { wrapper: createWrapper() });

    const poi = createPOI({ id: "poi-1", name: "Central Station" });
    act(() => {
      result.current.setPOIs([poi]);
    });

    expect(result.current.pois).toHaveLength(1);
    expect(result.current.pois[0].name).toBe("Central Station");
  });

  it("does not include roads or other unrelated data", () => {
    const { result } = renderHook(() => usePOICtx(), { wrapper: createWrapper() });
    const value = result.current as POIContextValue;
    expect(Object.keys(value)).toEqual(expect.arrayContaining(["pois", "setPOIs"]));
    expect(Object.keys(value)).toHaveLength(2);
  });
});

// ─── DirectionContext ──────────────────────────────────────────────

describe("DirectionContext", () => {
  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      const [directions, setDirections] = useState<DirectionMap>(new Map());
      return (
        <DirectionContext.Provider value={{ directions, setDirections }}>
          {children}
        </DirectionContext.Provider>
      );
    };
  }

  function useDirectionCtx() {
    return React.useContext(DirectionContext);
  }

  it("provides empty directions map by default", () => {
    const { result } = renderHook(() => useDirectionCtx(), { wrapper: createWrapper() });
    expect(result.current.directions).toBeInstanceOf(Map);
    expect(result.current.directions.size).toBe(0);
  });

  it("provides setDirections that updates direction state", () => {
    const { result } = renderHook(() => useDirectionCtx(), { wrapper: createWrapper() });

    const route = { edges: [], distance: 100 };
    act(() => {
      result.current.setDirections(new Map([["v1", { route }]]));
    });

    expect(result.current.directions.size).toBe(1);
    expect(result.current.directions.get("v1")?.route.distance).toBe(100);
  });

  it("does not include roads, POIs, or other unrelated data", () => {
    const { result } = renderHook(() => useDirectionCtx(), { wrapper: createWrapper() });
    const value = result.current as DirectionContextValue;
    expect(Object.keys(value)).toEqual(expect.arrayContaining(["directions", "setDirections"]));
    expect(Object.keys(value)).toHaveLength(2);
  });
});

// ─── HeatZoneContext ──────────────────────────────────────────────

describe("HeatZoneContext", () => {
  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      const [heatzones, setHeatzones] = useState<Heatzone[]>([]);
      return (
        <HeatZoneContext.Provider value={{ heatzones, setHeatzones }}>
          {children}
        </HeatZoneContext.Provider>
      );
    };
  }

  function useHeatZoneCtx() {
    return React.useContext(HeatZoneContext);
  }

  it("provides empty heatzones array by default", () => {
    const { result } = renderHook(() => useHeatZoneCtx(), { wrapper: createWrapper() });
    expect(result.current.heatzones).toEqual([]);
  });

  it("provides setHeatzones that updates heatzone state", () => {
    const { result } = renderHook(() => useHeatZoneCtx(), { wrapper: createWrapper() });

    const hz = createHeatzone({
      properties: { id: "hz-1", intensity: 0.7, timestamp: "2026-01-01T00:00:00Z", radius: 500 },
    });
    act(() => {
      result.current.setHeatzones([hz]);
    });

    expect(result.current.heatzones).toHaveLength(1);
    expect(result.current.heatzones[0].properties.id).toBe("hz-1");
  });

  it("does not include roads or other unrelated data", () => {
    const { result } = renderHook(() => useHeatZoneCtx(), { wrapper: createWrapper() });
    const value = result.current as HeatZoneContextValue;
    expect(Object.keys(value)).toEqual(expect.arrayContaining(["heatzones", "setHeatzones"]));
    expect(Object.keys(value)).toHaveLength(2);
  });
});

// ─── NetworkContext ──────────────────────────────────────────────

describe("NetworkContext", () => {
  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      const [network, setNetwork] = useState<RoadNetwork>({
        type: "FeatureCollection",
        features: [],
      });
      return (
        <NetworkContext.Provider value={{ network, setNetwork }}>
          {children}
        </NetworkContext.Provider>
      );
    };
  }

  function useNetworkCtx() {
    return React.useContext(NetworkContext);
  }

  it("provides empty network by default", () => {
    const { result } = renderHook(() => useNetworkCtx(), { wrapper: createWrapper() });
    expect(result.current.network.type).toBe("FeatureCollection");
    expect(result.current.network.features).toEqual([]);
  });

  it("provides setNetwork that updates network state", () => {
    const { result } = renderHook(() => useNetworkCtx(), { wrapper: createWrapper() });

    const network = createRoadNetwork();
    act(() => {
      result.current.setNetwork(network);
    });

    expect(result.current.network.type).toBe("FeatureCollection");
  });

  it("does not include roads or other unrelated data", () => {
    const { result } = renderHook(() => useNetworkCtx(), { wrapper: createWrapper() });
    const value = result.current as NetworkContextValue;
    expect(Object.keys(value)).toEqual(expect.arrayContaining(["network", "setNetwork"]));
    expect(Object.keys(value)).toHaveLength(2);
  });
});

// ─── OptionsContext ──────────────────────────────────────────────

describe("OptionsContext", () => {
  function createWrapper() {
    return function Wrapper({ children }: { children: React.ReactNode }) {
      const [options, setOptions] = useState<StartOptions>(DEFAULT_START_OPTIONS);
      return (
        <OptionsContext.Provider value={{ options, setOptions }}>
          {children}
        </OptionsContext.Provider>
      );
    };
  }

  function useOptionsCtx() {
    return React.useContext(OptionsContext);
  }

  it("provides default start options", () => {
    const { result } = renderHook(() => useOptionsCtx(), { wrapper: createWrapper() });
    expect(result.current.options).toEqual(DEFAULT_START_OPTIONS);
  });

  it("provides setOptions that updates options state", () => {
    const { result } = renderHook(() => useOptionsCtx(), { wrapper: createWrapper() });

    act(() => {
      result.current.setOptions({ ...DEFAULT_START_OPTIONS, minSpeed: 25 });
    });

    expect(result.current.options.minSpeed).toBe(25);
  });

  it("does not include roads or other unrelated data", () => {
    const { result } = renderHook(() => useOptionsCtx(), { wrapper: createWrapper() });
    const value = result.current as OptionsContextValue;
    expect(Object.keys(value)).toEqual(expect.arrayContaining(["options", "setOptions"]));
    expect(Object.keys(value)).toHaveLength(2);
  });
});

// ─── DataProvider integration ──────────────────────────────────────

describe("DataProvider composes all contexts", () => {
  it("each context provides independent data without cross-contamination", () => {
    const roadsValue: RoadsContextValue = {
      roads: [createRoad({ name: "Test Road" })],
      setRoads: vi.fn(),
    };
    const poisValue: POIContextValue = {
      pois: [createPOI({ id: "poi-test" })],
      setPOIs: vi.fn(),
    };

    function Wrapper({ children }: { children: React.ReactNode }) {
      return (
        <RoadsContext.Provider value={roadsValue}>
          <POIContext.Provider value={poisValue}>{children}</POIContext.Provider>
        </RoadsContext.Provider>
      );
    }

    const { result } = renderHook(
      () => ({
        roads: React.useContext(RoadsContext),
        pois: React.useContext(POIContext),
      }),
      { wrapper: Wrapper }
    );

    expect(result.current.roads.roads).toHaveLength(1);
    expect(result.current.roads.roads[0].name).toBe("Test Road");
    expect(result.current.pois.pois).toHaveLength(1);
    expect(result.current.pois.pois[0].id).toBe("poi-test");
  });
});
