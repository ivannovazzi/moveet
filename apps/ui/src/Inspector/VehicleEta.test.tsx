import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import VehicleEta from "./VehicleEta";
import { DirectionContext, type DirectionMap } from "@/data/context";
import type { EtaBreakdown, Route } from "@/types";

/** A route object is only ever read for its presence here — steps live elsewhere. */
const ROUTE = { edges: [], distance: 4 } as unknown as Route;

const BREAKDOWN: EtaBreakdown = {
  drivingSeconds: 600,
  nodeDelaySeconds: 120,
  turnSeconds: 45,
  weatherFactor: 1,
  learnedDistanceShare: 0.75,
};

function renderEta(
  options: {
    etaSeconds?: number;
    eta?: number;
    breakdown?: EtaBreakdown | null;
    routed?: boolean;
  } = {}
) {
  const { etaSeconds, eta = 780, breakdown = BREAKDOWN, routed = true } = options;
  const directions: DirectionMap = new Map();
  if (routed) {
    directions.set("v1", {
      route: ROUTE,
      eta,
      etaBreakdown: breakdown ?? undefined,
    });
  }
  return render(
    <DirectionContext.Provider value={{ directions, setDirections: vi.fn() }}>
      <VehicleEta vehicleId="v1" etaSeconds={etaSeconds} />
    </DirectionContext.Provider>
  );
}

describe("VehicleEta", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Fixed clock so the arrival readout is deterministic.
    vi.setSystemTime(new Date("2026-09-17T09:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("says so plainly when the vehicle has no route", () => {
    renderEta({ routed: false });
    expect(screen.getByText("No route assigned.")).toBeInTheDocument();
    // Never the Directions section's wording — a duplicate reads as a bug.
    expect(screen.queryByText("No active route.")).not.toBeInTheDocument();
  });

  it("shows the live remaining ETA as a duration", () => {
    renderEta({ etaSeconds: 12 * 60 });
    expect(screen.getByText("12 min")).toBeInTheDocument();
  });

  it("turns the remaining ETA into a wall-clock arrival time", () => {
    const { container } = renderEta({ etaSeconds: 30 * 60 });
    const expected = new Date(Date.now() + 30 * 60 * 1000).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(container.textContent).toContain(expected);
  });

  it("leaves the ETA as a gap when the vehicle sample carries none", () => {
    renderEta({ etaSeconds: undefined });
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("lists where the route's seconds go", () => {
    renderEta();
    expect(screen.getByText("Driving")).toBeInTheDocument();
    expect(screen.getByText("10 min")).toBeInTheDocument();
    expect(screen.getByText("Stops")).toBeInTheDocument();
    expect(screen.getByText("2 min")).toBeInTheDocument();
    expect(screen.getByText("Turns")).toBeInTheDocument();
    expect(screen.getByText("45 s")).toBeInTheDocument();
  });

  it("labels the composition as the whole route, not the remainder", () => {
    renderEta({ etaSeconds: 60, eta: 780 });
    expect(screen.getByText("Whole route")).toBeInTheDocument();
    expect(screen.getByText("13 min")).toBeInTheDocument();
  });

  it("reports how much of the route was priced from learned speeds", () => {
    renderEta();
    expect(screen.getByText("75% learned")).toBeInTheDocument();
  });

  it("says free-flow only when nothing on the route has been learned", () => {
    renderEta({ breakdown: { ...BREAKDOWN, learnedDistanceShare: 0 } });
    expect(screen.getByText("Free-flow only")).toBeInTheDocument();
  });

  it("states the weather effect in plain terms rather than as a raw factor", () => {
    renderEta({ breakdown: { ...BREAKDOWN, weatherFactor: 0.8 } });
    expect(screen.getByText("20% slower")).toBeInTheDocument();
    expect(screen.queryByText("0.8")).not.toBeInTheDocument();
  });

  it("says weather has no effect at a factor of 1", () => {
    renderEta();
    expect(screen.getByText("No effect")).toBeInTheDocument();
  });

  it("describes the composition bar for screen readers", () => {
    renderEta();
    expect(screen.getByRole("img", { name: /Route time composition/ })).toBeInTheDocument();
  });

  it("still shows the ETA when an older simulator sends no breakdown", () => {
    renderEta({ breakdown: null, etaSeconds: 300 });
    expect(screen.getByText("5 min")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Route time composition/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Driving")).not.toBeInTheDocument();
  });
});
