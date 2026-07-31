import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
    tab: "incidents",
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

describe("MonitorPanel", () => {
  it("renders the faults leaf for the Faults view", () => {
    render(<MonitorPanel {...props(faultsApi())} tab="faults" />);

    expect(screen.getByRole("switch", { name: /enable device fault injection/i })).toBeVisible();
  });

  it("renders incidents for the Incidents view", () => {
    render(<MonitorPanel {...props(faultsApi())} tab="incidents" />);

    expect(screen.getByRole("switch", { name: /auto-generate incidents/i })).toBeVisible();
    expect(
      screen.queryByRole("switch", { name: /enable device fault injection/i })
    ).not.toBeInTheDocument();
  });

  it("draws no tab strip of its own — the Monitor dock owns the buttons", () => {
    // Geofences and Heat Zones still have their own inner sub-tabs; the
    // section-level switch is the dock row's job (see SectionRail.test.tsx).
    render(<MonitorPanel {...props(faultsApi())} tab="incidents" />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
