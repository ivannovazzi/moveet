import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useFaults } from "./useFaults";
import client from "@/utils/client";
import { toast } from "@/lib/toast";
import type { DeviceFaultConfig, DeviceFaultState, DeviceFaultStatus } from "@moveet/shared-types";

vi.mock("@/utils/client", () => ({
  default: {
    getFaults: vi.fn(),
    configureFaults: vi.fn(),
    getFaultStatus: vi.fn(),
    resetFaults: vi.fn(),
    setVehicleFaultProfile: vi.fn(),
    clearVehicleFaultProfile: vi.fn(),
    onFaultsConfig: vi.fn(),
    offFaultsConfig: vi.fn(),
    onReset: vi.fn(),
    offReset: vi.fn(),
  },
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

function status(overrides: Partial<DeviceFaultStatus> = {}): DeviceFaultStatus {
  return {
    enabled: true,
    devices: 3,
    frozen: 1,
    teleporting: 0,
    dead: 0,
    held: 0,
    queued: 0,
    counts: {
      frozen_gps: 4,
      clock_skew: 0,
      duplicate: 2,
      out_of_order: 0,
      battery_dead: 0,
      teleport: 1,
    },
    ...overrides,
  };
}

function config(overrides: Partial<DeviceFaultConfig> = {}): DeviceFaultConfig {
  return { enabled: true, seed: 42, vehicles: {}, ...overrides };
}

function state(overrides: Partial<DeviceFaultState> = {}): DeviceFaultState {
  return { ...config(), status: status(), ...overrides };
}

describe("useFaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(client.getFaults).mockResolvedValue({ data: state() });
    vi.mocked(client.getFaultStatus).mockResolvedValue({ data: status() });
    vi.mocked(client.configureFaults).mockResolvedValue({ data: config() });
    vi.mocked(client.resetFaults).mockResolvedValue({ data: status({ frozen: 0 }) });
    vi.mocked(client.setVehicleFaultProfile).mockResolvedValue({ data: config() });
    vi.mocked(client.clearVehicleFaultProfile).mockResolvedValue({ data: config() });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the configuration and status in one request", async () => {
    const { result } = renderHook(() => useFaults(false));

    await waitFor(() => expect(result.current.config).not.toBeNull());
    expect(client.getFaults).toHaveBeenCalledTimes(1);
    expect(result.current.config?.seed).toBe(42);
    expect(result.current.status?.frozen).toBe(1);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a load failure", async () => {
    vi.mocked(client.getFaults).mockResolvedValue({ data: undefined, error: "boom" });

    const { result } = renderHook(() => useFaults(false));

    await waitFor(() => expect(result.current.error).toBe("boom"));
  });

  it("adopts a configuration pushed on faults:config", async () => {
    const { result } = renderHook(() => useFaults(false));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    const pushed = vi.mocked(client.onFaultsConfig).mock.calls[0][0];
    act(() => pushed(config({ enabled: false, seed: 7 })));

    expect(result.current.config?.enabled).toBe(false);
    expect(result.current.config?.seed).toBe(7);
  });

  it("polls status only while live, and stops on unmount", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useFaults(true));

    await vi.waitFor(() => expect(result.current.config).not.toBeNull());
    const afterLoad = vi.mocked(client.getFaultStatus).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(vi.mocked(client.getFaultStatus).mock.calls.length).toBeGreaterThan(afterLoad);

    unmount();
    const afterUnmount = vi.mocked(client.getFaultStatus).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(vi.mocked(client.getFaultStatus).mock.calls.length).toBe(afterUnmount);
  });

  it("does not poll status when not live", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFaults(false));
    await vi.waitFor(() => expect(result.current.config).not.toBeNull());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(client.getFaultStatus).not.toHaveBeenCalled();
  });

  it("arms the layer through configure and keeps the returned config", async () => {
    vi.mocked(client.configureFaults).mockResolvedValue({ data: config({ enabled: false }) });
    const { result } = renderHook(() => useFaults(false));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    await act(async () => {
      await result.current.configure({ enabled: false });
    });

    expect(client.configureFaults).toHaveBeenCalledWith({ enabled: false });
    expect(result.current.config?.enabled).toBe(false);
  });

  it("toasts and keeps the previous config when configure fails", async () => {
    vi.mocked(client.configureFaults).mockResolvedValue({ data: undefined, error: "nope" });
    const { result } = renderHook(() => useFaults(false));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    await act(async () => {
      await result.current.configure({ enabled: false });
    });

    expect(toast.error).toHaveBeenCalledWith("nope");
    expect(result.current.config?.enabled).toBe(true);
  });

  it("clears latched device state without touching the configuration", async () => {
    const { result } = renderHook(() => useFaults(false));
    await waitFor(() => expect(result.current.status?.frozen).toBe(1));

    await act(async () => {
      await result.current.reset();
    });

    expect(result.current.status?.frozen).toBe(0);
    expect(result.current.config?.enabled).toBe(true);
    expect(toast.success).toHaveBeenCalled();
  });

  it("sets and clears a per-vehicle profile", async () => {
    const withVehicle = config({ vehicles: { v1: { clockSkew: { offsetMs: 5000 } } } });
    vi.mocked(client.setVehicleFaultProfile).mockResolvedValue({ data: withVehicle });
    const { result } = renderHook(() => useFaults(false));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    await act(async () => {
      await result.current.setVehicleProfile("v1", { clockSkew: { offsetMs: 5000 } });
    });
    expect(client.setVehicleFaultProfile).toHaveBeenCalledWith("v1", {
      clockSkew: { offsetMs: 5000 },
    });
    expect(result.current.config?.vehicles.v1).toEqual({ clockSkew: { offsetMs: 5000 } });

    vi.mocked(client.clearVehicleFaultProfile).mockResolvedValue({ data: config() });
    await act(async () => {
      await result.current.clearVehicleProfile("v1");
    });
    expect(result.current.config?.vehicles).toEqual({});
  });

  it("refetches after a simulation reset, which drops device state", async () => {
    const { result } = renderHook(() => useFaults(false));
    await waitFor(() => expect(result.current.config).not.toBeNull());
    expect(client.getFaults).toHaveBeenCalledTimes(1);

    const onReset = vi.mocked(client.onReset).mock.calls[0][0];
    await act(async () => {
      onReset({ vehicles: [], directions: [] });
    });

    await waitFor(() => expect(client.getFaults).toHaveBeenCalledTimes(2));
  });
});
