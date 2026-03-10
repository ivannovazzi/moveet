import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import useTracking from "./useTracking";
import { useMapControls } from "@/components/Map/hooks";
import { createVehicle } from "@/test/mocks/types";

vi.mock("@/components/Map/hooks", () => ({
  useMapControls: vi.fn().mockReturnValue({
    focusOn: vi.fn(),
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useTracking", () => {
  it("calls focusOn with vehicle position and zoom 15 when a vehicle is selected", () => {
    const vehicle = createVehicle({ id: "v1", position: [36.82, -1.29] });
    const { focusOn } = vi.mocked(useMapControls)();

    renderHook(() => useTracking([vehicle], "v1"));

    expect(focusOn).toHaveBeenCalledWith(36.82, -1.29, 15, { duration: 0 });
  });

  it("does NOT call focusOn when no vehicle is selected", () => {
    const vehicle = createVehicle({ id: "v1" });
    const { focusOn } = vi.mocked(useMapControls)();

    renderHook(() => useTracking([vehicle], undefined));

    expect(focusOn).not.toHaveBeenCalled();
  });
});
