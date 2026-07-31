import { describe, expect, it, vi } from "vitest";
import { DispatchState } from "@/hooks/useDispatchState";
import type { InteractionMode } from "@/hooks/useInteractionMode";
import { MODE_LAUNCH_ITEMS, describeMode, type ModeContext } from "./modeDescriptors";

function ctx(overrides: Partial<ModeContext> = {}): ModeContext {
  return {
    dispatch: {
      state: DispatchState.SELECT,
      selectedCount: 0,
      stopCount: 0,
      assignmentCount: 0,
      successCount: 0,
      failureCount: 0,
      onExit: vi.fn(),
      onDispatch: vi.fn(),
      onRetryFailed: vi.fn(),
    },
    geofence: { vertexCount: 0, onCancel: vi.fn(), onConfirm: vi.fn() },
    job: { stage: "pickup", onCancel: vi.fn() },
    heatzone: { onStopDraw: vi.fn(), onDeselect: vi.fn() },
    ...overrides,
  };
}

const describeKind = (mode: InteractionMode, c: ModeContext = ctx()) => describeMode(mode, c);

describe("describeMode", () => {
  it("says nothing while browsing", () => {
    expect(describeKind({ kind: "browse" })).toBeNull();
  });

  it("describes every mode the union can be in", () => {
    const modes: InteractionMode[] = [
      { kind: "dispatch" },
      { kind: "draw-geofence" },
      { kind: "place-job" },
      { kind: "draw-heatzone" },
      { kind: "edit-heatzone", id: "hz-1" },
    ];

    for (const mode of modes) {
      const d = describeKind(mode);
      expect(d, mode.kind).not.toBeNull();
      expect(d?.label).toBeTruthy();
      expect(d?.hint).toBeTruthy();
      expect(d?.exitLabel).toBeTruthy();
    }
  });

  describe("dispatch", () => {
    it("gates the Dispatch action on having an assignment", () => {
      const withNone = describeKind(
        { kind: "dispatch" },
        ctx({
          dispatch: { ...ctx().dispatch, state: DispatchState.ROUTE, assignmentCount: 0 },
        })
      );
      expect(withNone?.primary?.enabled).toBe(false);

      const withOne = describeKind(
        { kind: "dispatch" },
        ctx({
          dispatch: {
            ...ctx().dispatch,
            state: DispatchState.ROUTE,
            assignmentCount: 1,
            stopCount: 2,
          },
        })
      );
      expect(withOne?.primary?.label).toBe("Dispatch");
      expect(withOne?.primary?.enabled).toBe(true);
      expect(withOne?.status).toBe("1 vehicle · 2 stops");
    });

    it("is dirty once vehicles are selected, clean before that", () => {
      expect(describeKind({ kind: "dispatch" })?.dirty).toBeNull();
      expect(
        describeKind(
          { kind: "dispatch" },
          ctx({ dispatch: { ...ctx().dispatch, selectedCount: 3 } })
        )?.dirty
      ).toBe("3 selected vehicles");
    });

    it("marks the in-flight phase busy and offers no primary action", () => {
      const d = describeKind(
        { kind: "dispatch" },
        ctx({ dispatch: { ...ctx().dispatch, state: DispatchState.DISPATCH } })
      );
      expect(d?.busy).toBe(true);
      expect(d?.primary).toBeUndefined();
    });

    it("offers a retry only when something failed", () => {
      const clean = describeKind(
        { kind: "dispatch" },
        ctx({
          dispatch: { ...ctx().dispatch, state: DispatchState.RESULTS, successCount: 2 },
        })
      );
      expect(clean?.primary?.label).toBe("Done");
      expect(clean?.tone).toBe("ok");
      expect(clean?.dirty).toBeNull();

      const failed = describeKind(
        { kind: "dispatch" },
        ctx({
          dispatch: {
            ...ctx().dispatch,
            state: DispatchState.RESULTS,
            successCount: 1,
            failureCount: 2,
          },
        })
      );
      expect(failed?.primary?.label).toBe("Retry failed");
      expect(failed?.tone).toBe("warn");
      expect(failed?.status).toBe("1 sent · 2 failed");
    });
  });

  describe("draw-geofence", () => {
    it("cannot be finished below the minimum vertex count", () => {
      const short = describeKind(
        { kind: "draw-geofence" },
        ctx({ geofence: { ...ctx().geofence, vertexCount: 2 } })
      );
      expect(short?.primary?.enabled).toBe(false);
      expect(short?.dirty).toBe("2-point zone");

      const ready = describeKind(
        { kind: "draw-geofence" },
        ctx({ geofence: { ...ctx().geofence, vertexCount: 3 } })
      );
      expect(ready?.primary?.enabled).toBe(true);
      expect(ready?.status).toBe("3 points");
    });

    it("exits by cancelling the draw, not by confirming it", () => {
      const onCancel = vi.fn();
      const onConfirm = vi.fn();
      describeKind(
        { kind: "draw-geofence" },
        ctx({ geofence: { vertexCount: 4, onCancel, onConfirm } })
      )?.exit();

      expect(onCancel).toHaveBeenCalledOnce();
      expect(onConfirm).not.toHaveBeenCalled();
    });
  });

  describe("place-job", () => {
    it("tracks the two clicks and is dirty only after the pickup lands", () => {
      const pickup = describeKind({ kind: "place-job" });
      expect(pickup?.status).toBe("Pickup");
      expect(pickup?.dirty).toBeNull();

      const dropoff = describeKind(
        { kind: "place-job" },
        ctx({ job: { stage: "dropoff", onCancel: vi.fn() } })
      );
      expect(dropoff?.status).toBe("Dropoff");
      expect(dropoff?.dirty).toBe("half-placed job");
    });
  });

  describe("heat zones", () => {
    it("says the map is locked, in both authoring modes", () => {
      expect(describeKind({ kind: "draw-heatzone" })?.locksPan).toBe(true);
      expect(describeKind({ kind: "edit-heatzone", id: "hz-1" })?.locksPan).toBe(true);
    });

    it("leaves drawing through the editor's own stop, so Escape and Done agree", () => {
      const onStopDraw = vi.fn();
      const d = describeKind(
        { kind: "draw-heatzone" },
        ctx({ heatzone: { onStopDraw, onDeselect: vi.fn() } })
      );

      d?.exit();
      d?.primary?.run();

      expect(onStopDraw).toHaveBeenCalledTimes(2);
    });
  });
});

describe("MODE_LAUNCH_ITEMS", () => {
  it("offers every startable mode exactly once, with a shortcut", () => {
    expect(MODE_LAUNCH_ITEMS.map((i) => i.kind)).toEqual([
      "dispatch",
      "place-job",
      "draw-geofence",
      "draw-heatzone",
    ]);
    for (const item of MODE_LAUNCH_ITEMS) {
      expect(item.shortcut, item.kind).toMatch(/^[A-Z]$/);
    }
  });
});
