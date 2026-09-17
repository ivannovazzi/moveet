import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Layer } from "@deck.gl/core";
import { ROADS_ORDER, useDeckLayerManager } from "./useDeckLayers";

/** A stand-in for a deck.gl layer — the manager only ever moves references. */
const layer = (id: string) => ({ id }) as unknown as Layer;

const ids = (layers: Layer[]) => layers.map((l) => l.id);

/** The manager coalesces into a microtask, so a flush has to be awaited. */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useDeckLayerManager", () => {
  it("splits registrations around the road network", async () => {
    const { result } = renderHook(() => useDeckLayerManager());

    act(() => {
      result.current.contextValue.registerLayers("ground", [layer("ground")], 1);
      result.current.contextValue.registerLayers("vehicles", [layer("vehicles")], 70);
    });
    await flush();

    expect(ids(result.current.registeredLayers.under)).toEqual(["ground"]);
    expect(ids(result.current.registeredLayers.over)).toEqual(["vehicles"]);
  });

  it("puts a layer registered exactly at the roads' order over them", async () => {
    const { result } = renderHook(() => useDeckLayerManager());

    act(() => {
      result.current.contextValue.registerLayers("edge", [layer("edge")], ROADS_ORDER);
    });
    await flush();

    expect(ids(result.current.registeredLayers.under)).toEqual([]);
    expect(ids(result.current.registeredLayers.over)).toEqual(["edge"]);
  });

  it("keeps each band sorted by order, not by registration sequence", async () => {
    const { result } = renderHook(() => useDeckLayerManager());

    act(() => {
      result.current.contextValue.registerLayers("vehicles", [layer("vehicles")], 70);
      result.current.contextValue.registerLayers("heatmap", [layer("heatmap")], 40);
      result.current.contextValue.registerLayers("ground", [layer("ground")], 1);
    });
    await flush();

    expect(ids(result.current.registeredLayers.over)).toEqual(["heatmap", "vehicles"]);
    expect(ids(result.current.registeredLayers.under)).toEqual(["ground"]);
  });

  it("falls back to the id's default order when none is passed", async () => {
    const { result } = renderHook(() => useDeckLayerManager());

    act(() => {
      result.current.contextValue.registerLayers("ground", [layer("ground")]);
      result.current.contextValue.registerLayers("vehicles", [layer("vehicles")]);
    });
    await flush();

    expect(ids(result.current.registeredLayers.under)).toEqual(["ground"]);
    expect(ids(result.current.registeredLayers.over)).toEqual(["vehicles"]);
  });

  it("drops a band's layers when its owner unregisters", async () => {
    const { result } = renderHook(() => useDeckLayerManager());

    act(() => {
      result.current.contextValue.registerLayers("ground", [layer("ground")], 1);
    });
    await flush();
    act(() => {
      result.current.contextValue.unregisterLayers("ground");
    });
    await flush();

    expect(result.current.registeredLayers.under).toEqual([]);
  });
});
