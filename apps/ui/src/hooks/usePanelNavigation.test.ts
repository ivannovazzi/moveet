import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePanelNavigation } from "./usePanelNavigation";

describe("usePanelNavigation", () => {
  it("initializes with no active panel", () => {
    const { result } = renderHook(() => usePanelNavigation(false));

    expect(result.current.activePanel).toBeNull();
  });

  it("setActivePanel changes the active panel", () => {
    const { result } = renderHook(() => usePanelNavigation(false));

    act(() => {
      result.current.setActivePanel("vehicles");
    });

    expect(result.current.activePanel).toBe("vehicles");
  });

  it("setActivePanel can switch between panels", () => {
    const { result } = renderHook(() => usePanelNavigation(false));

    act(() => {
      result.current.setActivePanel("vehicles");
    });
    expect(result.current.activePanel).toBe("vehicles");

    act(() => {
      result.current.setActivePanel("fleets");
    });
    expect(result.current.activePanel).toBe("fleets");
  });

  it("closePanel sets active panel to null", () => {
    const { result } = renderHook(() => usePanelNavigation(false));

    act(() => {
      result.current.setActivePanel("incidents");
    });
    expect(result.current.activePanel).toBe("incidents");

    act(() => {
      result.current.closePanel();
    });
    expect(result.current.activePanel).toBeNull();
  });

  it("auto-opens vehicles panel when dispatchMode becomes true", () => {
    const { result, rerender } = renderHook(
      ({ dispatchMode }) => usePanelNavigation(dispatchMode),
      { initialProps: { dispatchMode: false } }
    );

    expect(result.current.activePanel).toBeNull();

    rerender({ dispatchMode: true });

    expect(result.current.activePanel).toBe("vehicles");
  });

  it("does not change panel when dispatchMode is false", () => {
    const { result, rerender } = renderHook(
      ({ dispatchMode }) => usePanelNavigation(dispatchMode),
      { initialProps: { dispatchMode: false } }
    );

    act(() => {
      result.current.setActivePanel("fleets");
    });
    expect(result.current.activePanel).toBe("fleets");

    rerender({ dispatchMode: false });

    expect(result.current.activePanel).toBe("fleets");
  });

  it("overrides current panel to vehicles when dispatchMode turns on", () => {
    const { result, rerender } = renderHook(
      ({ dispatchMode }) => usePanelNavigation(dispatchMode),
      { initialProps: { dispatchMode: false } }
    );

    act(() => {
      result.current.setActivePanel("incidents");
    });
    expect(result.current.activePanel).toBe("incidents");

    rerender({ dispatchMode: true });

    expect(result.current.activePanel).toBe("vehicles");
  });
});
