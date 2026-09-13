import { describe, it, expect } from "vitest";
import { DispatchState } from "@/hooks/useDispatchState";
import type { InteractionModeKind } from "@/hooks/useInteractionMode";
import { cursorForMode } from "./modeCursor";

describe("cursorForMode", () => {
  const table: [InteractionModeKind, string][] = [
    ["browse", "grab"],
    ["draw-geofence", "crosshair"],
    ["draw-heatzone", "crosshair"],
    ["place-job", "crosshair"],
    ["edit-heatzone", "default"],
  ];

  for (const [kind, cursor] of table) {
    it(`maps ${kind} to ${cursor}`, () => {
      expect(cursorForMode(kind)).toBe(cursor);
    });
  }

  it("defers to the dispatch state machine in dispatch mode", () => {
    expect(cursorForMode("dispatch", DispatchState.ROUTE)).toBe("crosshair");
    expect(cursorForMode("dispatch", DispatchState.DISPATCH)).toBe("wait");
    expect(cursorForMode("dispatch", DispatchState.SELECT)).toBe("grab");
  });

  it("falls back to grab when dispatch mode has no state yet", () => {
    expect(cursorForMode("dispatch")).toBe("grab");
  });

  it("ignores the dispatch state outside dispatch mode", () => {
    expect(cursorForMode("browse", DispatchState.DISPATCH)).toBe("grab");
    expect(cursorForMode("draw-heatzone", DispatchState.DISPATCH)).toBe("crosshair");
  });
});
