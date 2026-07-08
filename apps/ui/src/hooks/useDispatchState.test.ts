import { describe, it, expect } from "vitest";
import { deriveDispatchState, cursorForDispatchState, DispatchState } from "./useDispatchState";
import type { DispatchAssignment, DirectionResult } from "@/types";

function makeSignals(
  overrides: Partial<{
    dispatchMode: boolean;
    selectedForDispatch: string[];
    assignments: DispatchAssignment[];
    dispatching: boolean;
    results: DirectionResult[];
  }> = {}
) {
  return {
    dispatchMode: false,
    selectedForDispatch: [] as string[],
    assignments: [] as DispatchAssignment[],
    dispatching: false,
    results: [] as DirectionResult[],
    ...overrides,
  };
}

describe("deriveDispatchState", () => {
  it("returns BROWSE when dispatchMode is false", () => {
    expect(deriveDispatchState(makeSignals())).toBe(DispatchState.BROWSE);
  });

  it("returns SELECT when dispatchMode=true, no selection, no assignments, not dispatching, no results", () => {
    expect(deriveDispatchState(makeSignals({ dispatchMode: true }))).toBe(DispatchState.SELECT);
  });

  it("returns ROUTE when dispatchMode=true, selectedForDispatch has items", () => {
    expect(
      deriveDispatchState(
        makeSignals({
          dispatchMode: true,
          selectedForDispatch: ["v1", "v2"],
        })
      )
    ).toBe(DispatchState.ROUTE);
  });

  it("returns DISPATCH when dispatching=true (even if other signals are set)", () => {
    expect(
      deriveDispatchState(
        makeSignals({
          dispatchMode: true,
          selectedForDispatch: ["v1"],
          assignments: [
            { vehicleId: "v1", vehicleName: "Truck", waypoints: [{ position: [-1.29, 36.82] }] },
          ],
          dispatching: true,
          results: [{ vehicleId: "v1", status: "ok" }],
        })
      )
    ).toBe(DispatchState.DISPATCH);
  });

  it("returns RESULTS when results.length > 0 (not dispatching)", () => {
    expect(
      deriveDispatchState(
        makeSignals({
          dispatchMode: true,
          selectedForDispatch: ["v1"],
          results: [{ vehicleId: "v1", status: "ok" }],
        })
      )
    ).toBe(DispatchState.RESULTS);
  });

  it("returns BROWSE when dispatchMode=false even if other signals are set", () => {
    expect(
      deriveDispatchState(
        makeSignals({
          dispatchMode: false,
          selectedForDispatch: ["v1"],
          assignments: [
            { vehicleId: "v1", vehicleName: "Truck", waypoints: [{ position: [-1.29, 36.82] }] },
          ],
          dispatching: true,
          results: [{ vehicleId: "v1", status: "ok" }],
        })
      )
    ).toBe(DispatchState.BROWSE);
  });
});

describe("cursorForDispatchState", () => {
  it('returns "crosshair" for ROUTE', () => {
    expect(cursorForDispatchState(DispatchState.ROUTE)).toBe("crosshair");
  });

  it('returns "wait" for DISPATCH', () => {
    expect(cursorForDispatchState(DispatchState.DISPATCH)).toBe("wait");
  });

  // Non-override states must return "grab": DeckGLMap's getCursor only falls
  // through to hover/drag feedback (pointer/grabbing) when the cursor is "grab".
  it('returns "grab" for BROWSE', () => {
    expect(cursorForDispatchState(DispatchState.BROWSE)).toBe("grab");
  });

  it('returns "grab" for SELECT', () => {
    expect(cursorForDispatchState(DispatchState.SELECT)).toBe("grab");
  });

  it('returns "grab" for RESULTS', () => {
    expect(cursorForDispatchState(DispatchState.RESULTS)).toBe("grab");
  });

  it('returns "grab" for undefined', () => {
    expect(cursorForDispatchState(undefined)).toBe("grab");
  });
});
