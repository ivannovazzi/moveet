import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useModeGuard } from "./useModeGuard";

describe("useModeGuard", () => {
  it("runs the action straight away when the active mode holds nothing", () => {
    const { result } = renderHook(() => useModeGuard(null));
    const action = vi.fn();

    act(() => result.current.request(action));

    expect(action).toHaveBeenCalledOnce();
    expect(result.current.pending).toBeNull();
  });

  it("holds the action and names what would be lost", () => {
    const { result } = renderHook(() => useModeGuard("4-point zone"));
    const action = vi.fn();

    act(() => result.current.request(action));

    expect(action).not.toHaveBeenCalled();
    expect(result.current.pending?.loses).toBe("4-point zone");
  });

  it("confirming runs the held action exactly once", () => {
    const { result } = renderHook(() => useModeGuard("4-point zone"));
    const action = vi.fn();

    act(() => result.current.request(action));
    act(() => result.current.confirm());

    expect(action).toHaveBeenCalledOnce();
    expect(result.current.pending).toBeNull();
  });

  it("dismissing drops the action and keeps the mode", () => {
    const { result } = renderHook(() => useModeGuard("half-placed job"));
    const action = vi.fn();

    act(() => result.current.request(action));
    act(() => result.current.dismiss());

    expect(action).not.toHaveBeenCalled();
    expect(result.current.pending).toBeNull();
  });

  it("honours the request when the mode lets go of its work while we ask", () => {
    // The polygon was finished (or cancelled) elsewhere: there is nothing left
    // to discard, so the thing the operator asked for should just happen.
    const { result, rerender } = renderHook(
      ({ dirty }: { dirty: string | null }) => useModeGuard(dirty),
      { initialProps: { dirty: "4-point zone" as string | null } }
    );
    const action = vi.fn();

    act(() => result.current.request(action));
    expect(action).not.toHaveBeenCalled();

    rerender({ dirty: null });

    expect(action).toHaveBeenCalledOnce();
    expect(result.current.pending).toBeNull();
  });

  it("keeps `request` stable while the mode's dirtiness changes", () => {
    const { result, rerender } = renderHook(
      ({ dirty }: { dirty: string | null }) => useModeGuard(dirty),
      { initialProps: { dirty: null as string | null } }
    );

    const first = result.current.request;
    rerender({ dirty: "2 selected vehicles" });

    expect(result.current.request).toBe(first);
  });
});
