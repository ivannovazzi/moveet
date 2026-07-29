import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FaultsPanel from "./FaultsPanel";
import type { UseFaults } from "@/hooks/useFaults";
import type { DeviceFaultConfig, DeviceFaultStatus } from "@/types";
import { FAULT_PRESETS } from "@/lib/faultPresets";

function status(overrides: Partial<DeviceFaultStatus> = {}): DeviceFaultStatus {
  return {
    enabled: true,
    devices: 2,
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

function config(overrides: Partial<DeviceFaultConfig> = {}): DeviceFaultConfig {
  return { enabled: false, vehicles: {}, ...overrides };
}

function faultsApi(overrides: Partial<UseFaults> = {}): UseFaults {
  return {
    config: config(),
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

const VEHICLES = [
  { id: "v1", name: "Unit 1" },
  { id: "v2", name: "Unit 2" },
];

function renderPanel(overrides: Partial<UseFaults> = {}) {
  const faults = faultsApi(overrides);
  render(<FaultsPanel faults={faults} vehicles={VEHICLES} />);
  return faults;
}

describe("FaultsPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows a loading state before the first snapshot", () => {
    render(
      <FaultsPanel
        faults={faultsApi({ config: null, status: null, loading: true })}
        vehicles={VEHICLES}
      />
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Reading fault configuration/i);
  });

  it("arms and disarms the layer through the switch", async () => {
    const user = userEvent.setup();
    const faults = renderPanel();

    await user.click(screen.getByRole("switch", { name: /enable device fault injection/i }));

    expect(faults.configure).toHaveBeenCalledWith({ enabled: true });
  });

  it("reads as armed when the layer is enabled", () => {
    renderPanel({ config: config({ enabled: true }) });

    expect(screen.getByRole("switch", { name: /enable device fault injection/i })).toBeChecked();
    expect(screen.getByText("Armed")).toBeInTheDocument();
  });

  it("warns when armed with nothing to inject", () => {
    renderPanel({ config: config({ enabled: true }) });

    expect(screen.getByText(/no profile is set/i)).toBeInTheDocument();
  });

  it("does not warn when a profile is armed", () => {
    renderPanel({
      config: config({ enabled: true, default: { duplicate: { probability: 0.2, maxCopies: 2 } } }),
    });

    expect(screen.queryByText(/no profile is set/i)).not.toBeInTheDocument();
  });

  it("commits a seed on blur, not on every keystroke", async () => {
    const user = userEvent.setup();
    const faults = renderPanel();

    const seed = screen.getByLabelText(/fault rng seed/i);
    await user.type(seed, "77");
    expect(faults.configure).not.toHaveBeenCalled();

    await user.tab();
    expect(faults.configure).toHaveBeenCalledWith({ seed: 77 });
  });

  it("does not re-send a seed that has not changed", async () => {
    const user = userEvent.setup();
    const faults = renderPanel({ config: config({ seed: 42 }) });

    const seed = screen.getByLabelText(/fault rng seed/i);
    await user.click(seed);
    await user.tab();

    expect(faults.configure).not.toHaveBeenCalled();
  });

  it("applies a fleet-wide preset", async () => {
    const user = userEvent.setup();
    const faults = renderPanel();
    const preset = FAULT_PRESETS[0];

    await user.click(screen.getByRole("button", { name: preset.label }));

    expect(faults.configure).toHaveBeenCalledWith({ default: preset.profile });
  });

  it("marks the fleet-wide preset currently in force", () => {
    const preset = FAULT_PRESETS[1];
    renderPanel({ config: config({ default: preset.profile }) });

    expect(screen.getByRole("button", { name: preset.label })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("clears the fleet-wide profile with an explicit null", async () => {
    const user = userEvent.setup();
    const faults = renderPanel({ config: config({ default: FAULT_PRESETS[0].profile }) });

    await user.click(screen.getByRole("button", { name: "Clear" }));

    expect(faults.configure).toHaveBeenCalledWith({ default: null });
  });

  it("arms a preset on one device", async () => {
    const user = userEvent.setup();
    const faults = renderPanel();

    await user.selectOptions(screen.getByLabelText(/vehicle to arm/i), "v2");
    await user.selectOptions(screen.getByLabelText(/fault preset to arm/i), FAULT_PRESETS[2].id);

    expect(faults.setVehicleProfile).toHaveBeenCalledWith("v2", FAULT_PRESETS[2].profile);
  });

  it("pre-selects the inspected vehicle", () => {
    render(<FaultsPanel faults={faultsApi()} vehicles={VEHICLES} selectedVehicleId="v2" />);

    expect(screen.getByLabelText(/vehicle to arm/i)).toHaveValue("v2");
  });

  it("lists per-device profiles by vehicle name and clears one", async () => {
    const user = userEvent.setup();
    const faults = renderPanel({
      config: config({ vehicles: { v1: { clockSkew: { offsetMs: -45_000 } } } }),
    });

    // "Unit 1" also appears as an option in the arming select, so identify the
    // profile row by the description only it carries.
    expect(screen.getByText(/skew -45s/)).toBeInTheDocument();
    expect(screen.getAllByText("Unit 1").length).toBeGreaterThan(1);

    await user.click(screen.getByRole("button", { name: /clear fault profile for Unit 1/i }));
    expect(faults.clearVehicleProfile).toHaveBeenCalledWith("v1");
  });

  it("falls back to the vehicle id when the roster does not know it", () => {
    renderPanel({
      config: config({ vehicles: { ghost: { duplicate: { probability: 0.5, maxCopies: 2 } } } }),
    });

    expect(screen.getByText("ghost")).toBeInTheDocument();
  });

  it("clears latched device state without touching the config", async () => {
    const user = userEvent.setup();
    const faults = renderPanel();

    await user.click(screen.getByRole("button", { name: /clear state/i }));

    expect(faults.reset).toHaveBeenCalled();
    expect(faults.configure).not.toHaveBeenCalled();
  });

  it("shows live device counters", () => {
    renderPanel({ status: status({ devices: 5, frozen: 2, dead: 1 }) });

    const frozen = screen.getByText("frozen").closest("div") as HTMLElement;
    expect(within(frozen).getByText("2")).toBeInTheDocument();
    const dead = screen.getByText("dead").closest("div") as HTMLElement;
    expect(within(dead).getByText("1")).toBeInTheDocument();
  });

  it("summarises per-kind trigger counts once faults have fired", () => {
    renderPanel({
      status: status({ counts: { ...status().counts, frozen_gps: 4, teleport: 1 } }),
    });

    expect(screen.getByText(/frozen 4/)).toBeInTheDocument();
    expect(screen.getByText(/spoofed 1/)).toBeInTheDocument();
    expect(screen.queryByText(/No faults injected yet/)).not.toBeInTheDocument();
  });

  it("says so when nothing has fired yet", () => {
    renderPanel();

    expect(screen.getByText(/No faults injected yet/)).toBeInTheDocument();
  });

  it("surfaces a hook error", () => {
    renderPanel({ error: "simulator unreachable" });

    expect(screen.getByText("simulator unreachable")).toBeInTheDocument();
  });
});
