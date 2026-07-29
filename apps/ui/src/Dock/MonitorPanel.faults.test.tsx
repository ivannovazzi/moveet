import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MonitorPanel, { type MonitorPanelProps } from "./MonitorPanel";
import type { UseFaults } from "@/hooks/useFaults";
import type { DeviceFaultStatus } from "@/types";

function status(overrides: Partial<DeviceFaultStatus> = {}): DeviceFaultStatus {
  return {
    enabled: true,
    devices: 3,
    frozen: 0,
    teleporting: 0,
    dead: 0,
    held: 0,
    queued: 0,
    counts: {
      frozen_gps: 0,
      clock_skew: 0,
      duplicate: 0,
      out_of_order: 0,
      battery_dead: 0,
      teleport: 0,
    },
    ...overrides,
  };
}

function faultsApi(overrides: Partial<UseFaults> = {}): UseFaults {
  return {
    config: { enabled: true, vehicles: {} },
    status: status(),
    loading: false,
    error: null,
    configure: vi.fn().mockResolvedValue(undefined),
    setVehicleProfile: vi.fn().mockResolvedValue(undefined),
    clearVehicleProfile: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function props(faults: UseFaults): MonitorPanelProps {
  return {
    incidents: {
      incidents: [],
      createRandom: vi.fn(),
      remove: vi.fn(),
      error: null,
    } as unknown as MonitorPanelProps["incidents"],
    analytics: { summary: null, fleetHistory: new Map(), summaryHistory: [] },
    geofences: {
      fences: [],
      onFenceToggle: vi.fn(),
      onFenceDelete: vi.fn(),
      alerts: [],
      drawingActive: false,
      vertexCount: 0,
      onStartDrawing: vi.fn(),
      onCancelDrawing: vi.fn(),
      onConfirmDrawing: vi.fn(),
    } as unknown as MonitorPanelProps["geofences"],
    faults: { faults, vehicles: [{ id: "v1", name: "Unit 1" }] },
  };
}

describe("MonitorPanel faults tab", () => {
  it("offers Faults as a tab and opens the panel", async () => {
    const user = userEvent.setup();
    render(<MonitorPanel {...props(faultsApi())} />);

    const tab = screen.getByRole("tab", { name: /faults/i });
    await user.click(tab);

    expect(screen.getByRole("switch", { name: /enable device fault injection/i })).toBeVisible();
  });

  it("badges the tab with the number of misbehaving devices", () => {
    render(<MonitorPanel {...props(faultsApi({ status: status({ frozen: 2, dead: 1 }) }))} />);

    expect(screen.getByRole("tab", { name: /faults/i })).toHaveTextContent("3");
  });

  it("does not badge a disarmed layer, even with latched counters", () => {
    render(
      <MonitorPanel
        {...props(
          faultsApi({
            config: { enabled: false, vehicles: {} },
            status: status({ frozen: 4, enabled: false }),
          })
        )}
      />
    );

    expect(screen.getByRole("tab", { name: /faults/i })).not.toHaveTextContent("4");
  });

  it("starts on Incidents so the default view is unchanged", () => {
    render(<MonitorPanel {...props(faultsApi())} />);

    expect(screen.getByRole("tab", { name: /incidents/i })).toHaveAttribute(
      "aria-selected",
      "true"
    );
  });
});
