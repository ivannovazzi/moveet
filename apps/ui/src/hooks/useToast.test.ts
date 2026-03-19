import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useToast } from "./useToast";

describe("useToast", () => {
  it("starts with empty toasts array", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toasts).toEqual([]);
  });

  it("addToast adds a toast with correct type and message", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Something went wrong", "error");
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Something went wrong");
    expect(result.current.toasts[0].type).toBe("error");
  });

  it("addToast generates unique IDs", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("First", "info");
      result.current.addToast("Second", "success");
    });

    const ids = result.current.toasts.map((t) => t.id);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("removeToast removes specific toast by ID", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("First", "info");
      result.current.addToast("Second", "error");
    });

    expect(result.current.toasts).toHaveLength(2);

    const idToRemove = result.current.toasts[0].id;

    act(() => {
      result.current.removeToast(idToRemove);
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].message).toBe("Second");
  });

  it("multiple toasts can coexist", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.addToast("Error toast", "error");
      result.current.addToast("Success toast", "success");
      result.current.addToast("Info toast", "info");
    });

    expect(result.current.toasts).toHaveLength(3);
    expect(result.current.toasts[0].type).toBe("error");
    expect(result.current.toasts[1].type).toBe("success");
    expect(result.current.toasts[2].type).toBe("info");
  });
});
