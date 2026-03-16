import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import React from "react";
import { useOptions } from "./useOptions";
import { OptionsContext } from "@/data/context";
import { DEFAULT_START_OPTIONS } from "@/data/constants";
import type { StartOptions } from "@/types";
import client from "@/utils/client";

vi.mock("@/utils/client", () => ({
  default: {
    getOptions: vi.fn(),
    onOptions: vi.fn(),
    updateOptions: vi.fn(),
  },
}));

function createWrapper(
  options: StartOptions,
  setOptions: React.Dispatch<React.SetStateAction<StartOptions>>,
) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(OptionsContext.Provider, {
      value: {
        options,
        setOptions,
      },
      children,
    });
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getOptions).mockResolvedValue({ data: undefined });
  vi.mocked(client.onOptions).mockImplementation(() => {});
  vi.mocked(client.updateOptions).mockResolvedValue({ data: undefined });
});

describe("useOptions", () => {
  it("returns initial default options", () => {
    const setOptions = vi.fn();
    const { result } = renderHook(() => useOptions(300), {
      wrapper: createWrapper(DEFAULT_START_OPTIONS, setOptions),
    });

    expect(result.current.options).toEqual(DEFAULT_START_OPTIONS);
  });

  it("fetches options on mount", async () => {
    const serverOptions = { ...DEFAULT_START_OPTIONS, minSpeed: 20 };
    vi.mocked(client.getOptions).mockResolvedValue({ data: serverOptions });

    const setOptions = vi.fn();
    renderHook(() => useOptions(300), {
      wrapper: createWrapper(DEFAULT_START_OPTIONS, setOptions),
    });

    await vi.waitFor(() => {
      expect(setOptions).toHaveBeenCalledWith(serverOptions);
    });
  });

  it("subscribes to WS options updates", () => {
    const setOptions = vi.fn();
    renderHook(() => useOptions(300), {
      wrapper: createWrapper(DEFAULT_START_OPTIONS, setOptions),
    });

    const onOptionsMock = vi.mocked(client.onOptions);
    expect(onOptionsMock).toHaveBeenCalledOnce();

    const handler = onOptionsMock.mock.calls[0][0];
    const wsOptions = { ...DEFAULT_START_OPTIONS, maxSpeed: 100 };

    act(() => {
      handler(wsOptions);
    });

    expect(setOptions).toHaveBeenCalledWith(wsOptions);
  });

  it("updateOption updates local state immediately", () => {
    const setOptions = vi.fn();
    const { result } = renderHook(() => useOptions(300), {
      wrapper: createWrapper(DEFAULT_START_OPTIONS, setOptions),
    });

    act(() => {
      result.current.updateOption("minSpeed", 25);
    });

    // setOptions should have been called with a function updater
    // (once from mount effect, then from updateOption)
    const lastCall = setOptions.mock.calls[setOptions.mock.calls.length - 1];
    const updater = lastCall[0];
    expect(typeof updater).toBe("function");

    // Call the updater with current options to verify the result
    const newOptions = updater(DEFAULT_START_OPTIONS);
    expect(newOptions).toEqual({ ...DEFAULT_START_OPTIONS, minSpeed: 25 });
  });

  it("updateOption debounces server writes", () => {
    vi.useFakeTimers();
    const setOptions = vi.fn();

    // Make setOptions invoke the updater so the timer gets scheduled
    setOptions.mockImplementation((updaterOrValue) => {
      if (typeof updaterOrValue === "function") {
        updaterOrValue(DEFAULT_START_OPTIONS);
      }
    });

    const { result } = renderHook(() => useOptions(300), {
      wrapper: createWrapper(DEFAULT_START_OPTIONS, setOptions),
    });

    act(() => {
      result.current.updateOption("minSpeed", 25);
    });

    // Server write should NOT have happened yet
    expect(client.updateOptions).not.toHaveBeenCalled();

    act(() => {
      result.current.updateOption("minSpeed", 30);
    });

    // Still no server write
    expect(client.updateOptions).not.toHaveBeenCalled();

    // Advance past the debounce timeout
    act(() => {
      vi.advanceTimersByTime(300);
    });

    // Now the server write should have happened once (debounced)
    expect(client.updateOptions).toHaveBeenCalledOnce();

    vi.useRealTimers();
  });
});
