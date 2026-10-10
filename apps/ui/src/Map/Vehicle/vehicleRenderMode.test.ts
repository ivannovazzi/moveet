import { describe, it, expect } from "vitest";
import {
  MESH_MIN_PITCH_DEG,
  MESH_PITCH_HYSTERESIS_DEG,
  MESH_PITCHED_MIN_ZOOM,
  MESH_TOP_DOWN_MIN_ZOOM,
  MESH_ZOOM_HYSTERESIS,
  nextUse3D,
} from "./vehicleRenderMode";

const PITCHED = MESH_MIN_PITCH_DEG + 10;

describe("nextUse3D", () => {
  describe("entering 3D from sprites", () => {
    it("stays flat top-down below the top-down zoom", () => {
      expect(nextUse3D(false, MESH_TOP_DOWN_MIN_ZOOM - 0.01, 0)).toBe(false);
    });

    it("goes 3D top-down at the top-down zoom", () => {
      expect(nextUse3D(false, MESH_TOP_DOWN_MIN_ZOOM, 0)).toBe(true);
    });

    it("goes 3D at the pitched zoom once the camera leans far enough", () => {
      expect(nextUse3D(false, MESH_PITCHED_MIN_ZOOM, MESH_MIN_PITCH_DEG)).toBe(true);
    });

    it("stays flat at the pitched zoom with too little pitch", () => {
      expect(nextUse3D(false, MESH_PITCHED_MIN_ZOOM, MESH_MIN_PITCH_DEG - 0.1)).toBe(false);
    });

    it("stays flat pitched but too far out", () => {
      expect(nextUse3D(false, MESH_PITCHED_MIN_ZOOM - 0.01, 60)).toBe(false);
    });

    it("does not enter within the hysteresis band", () => {
      expect(nextUse3D(false, MESH_PITCHED_MIN_ZOOM - MESH_ZOOM_HYSTERESIS / 2, PITCHED)).toBe(
        false
      );
      expect(
        nextUse3D(false, MESH_PITCHED_MIN_ZOOM, MESH_MIN_PITCH_DEG - MESH_PITCH_HYSTERESIS_DEG / 2)
      ).toBe(false);
    });
  });

  describe("leaving 3D for sprites", () => {
    it("holds 3D while zoom sits just under the pitched threshold", () => {
      expect(nextUse3D(true, MESH_PITCHED_MIN_ZOOM - MESH_ZOOM_HYSTERESIS / 2, PITCHED)).toBe(true);
    });

    it("drops to sprites once zoom clears the band", () => {
      expect(nextUse3D(true, MESH_PITCHED_MIN_ZOOM - MESH_ZOOM_HYSTERESIS - 0.01, PITCHED)).toBe(
        false
      );
    });

    it("holds 3D while pitch sits just under its threshold", () => {
      const pitch = MESH_MIN_PITCH_DEG - MESH_PITCH_HYSTERESIS_DEG / 2;
      expect(nextUse3D(true, MESH_PITCHED_MIN_ZOOM, pitch)).toBe(true);
    });

    it("drops to sprites once pitch clears the band", () => {
      const pitch = MESH_MIN_PITCH_DEG - MESH_PITCH_HYSTERESIS_DEG - 0.1;
      expect(nextUse3D(true, MESH_PITCHED_MIN_ZOOM, pitch)).toBe(false);
    });

    it("holds top-down 3D just under the top-down zoom", () => {
      expect(nextUse3D(true, MESH_TOP_DOWN_MIN_ZOOM - MESH_ZOOM_HYSTERESIS / 2, 0)).toBe(true);
    });

    it("drops top-down 3D once zoom clears the band", () => {
      expect(nextUse3D(true, MESH_TOP_DOWN_MIN_ZOOM - MESH_ZOOM_HYSTERESIS - 0.01, 0)).toBe(false);
    });
  });

  it("does not flicker when the camera jitters on a threshold", () => {
    let mode = false;
    const flips: boolean[] = [];
    for (const zoom of [15.9, 16.0, 15.9, 16.0, 15.8, 16.1, 15.7, 15.6]) {
      const next = nextUse3D(mode, zoom, PITCHED);
      if (next !== mode) flips.push(next);
      mode = next;
    }
    // In once at 16, out once below 15.5, and nothing in between.
    expect(flips).toEqual([true]);
    expect(nextUse3D(mode, 15.4, PITCHED)).toBe(false);
  });

  it("keeps the current mode on a non-finite zoom", () => {
    expect(nextUse3D(true, Number.NaN, PITCHED)).toBe(true);
    expect(nextUse3D(false, Number.NaN, PITCHED)).toBe(false);
  });

  it("treats a non-finite pitch as flat", () => {
    expect(nextUse3D(false, MESH_PITCHED_MIN_ZOOM, Number.NaN)).toBe(false);
  });
});
