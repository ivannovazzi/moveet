import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalyticsSummary, FleetAnalytics } from "@/hooks/analyticsStore";
import type { AnalyticsHistoryRow } from "@/hooks/useAnalytics";

const resetAnalytics = vi.fn();

vi.mock("@/utils/client", () => ({
  default: { resetAnalytics: () => resetAnalytics() },
}));

import AnalyticsPanel from "./AnalyticsPanel";

const T0 = Date.UTC(2026, 6, 25, 10, 0, 0);

function makeSummary(index: number, overrides: Partial<AnalyticsSummary> = {}): AnalyticsSummary {
  return {
    totalVehicles: 10,
    activeVehicles: 6 + index,
    totalDistanceTraveled: 100 + index * 10,
    avgSpeed: 30 + index,
    totalIdleTime: 20,
    avgRouteEfficiency: 0.8,
    timestamp: T0 + index * 5000,
    ...overrides,
  };
}

function makeFleet(overrides: Partial<FleetAnalytics> = {}): FleetAnalytics {
  return {
    fleetId: "alpha",
    vehicleCount: 4,
    activeCount: 3,
    totalDistance: 42,
    avgSpeed: 31,
    totalIdleTime: 5,
    routeEfficiency: 0.9,
    vehicles: [],
    ...overrides,
  };
}

function renderPanel(props: Partial<React.ComponentProps<typeof AnalyticsPanel>> = {}) {
  return render(
    <AnalyticsPanel
      summary={null}
      summaryHistory={[]}
      fleetHistory={new Map()}
      fetchHistory={vi.fn().mockResolvedValue({ data: [] })}
      {...props}
    />
  );
}

beforeEach(() => {
  resetAnalytics.mockClear();
});

describe("AnalyticsPanel — loading and empty states", () => {
  it("says it is waiting instead of rendering blank axes", () => {
    renderPanel();

    expect(screen.getByRole("status")).toHaveTextContent(/Waiting for the first analytics/i);
    expect(screen.queryByTestId("shared-time-axis")).not.toBeInTheDocument();
    expect(screen.queryByTestId("facet-speed")).not.toBeInTheDocument();
  });

  it("keeps the range control usable while waiting", () => {
    renderPanel();
    expect(screen.getByRole("tab", { name: "Live" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "24h" })).toBeInTheDocument();
  });

  it("shows the stats but explains the missing trend on a single sample", () => {
    const summary = makeSummary(0);
    renderPanel({ summary, summaryHistory: [summary] });

    expect(screen.getByText(/Collecting samples/i)).toBeInTheDocument();
    expect(screen.getByText("Avg Speed")).toBeInTheDocument();
    expect(screen.queryByTestId("shared-time-axis")).not.toBeInTheDocument();
  });
});

describe("AnalyticsPanel — live window", () => {
  const summaryHistory = [makeSummary(0), makeSummary(1), makeSummary(2)];
  const summary = summaryHistory[2];

  it("renders the KPI tiles from the latest sample", () => {
    renderPanel({ summary, summaryHistory });

    expect(within(screen.getByTestId("stat-vehicles")).getByText("8")).toBeInTheDocument();
    expect(within(screen.getByTestId("stat-vehicles")).getByText("/ 10")).toBeInTheDocument();
    expect(within(screen.getByTestId("stat-avg-speed")).getByText("32.0")).toBeInTheDocument();
    expect(within(screen.getByTestId("stat-distance")).getByText("120")).toBeInTheDocument();
    expect(within(screen.getByTestId("stat-efficiency")).getByText("80%")).toBeInTheDocument();
  });

  it("labels the window in the subtitle", () => {
    renderPanel({ summary, summaryHistory });
    expect(screen.getByText("8 of 10 vehicles active")).toBeInTheDocument();
  });

  it("shows a signed delta over the window with a direction glyph", () => {
    renderPanel({ summary, summaryHistory });

    const deltas = screen.getAllByTestId("stat-delta");
    // avgSpeed rose 30 → 32 across the window.
    expect(deltas.some((d) => d.textContent?.includes("+2.0"))).toBe(true);
    // Direction is carried by an icon as well as by colour.
    expect(deltas[0].querySelector("svg")).toBeTruthy();
  });

  it("draws one facet per measure over a single shared axis", () => {
    renderPanel({ summary, summaryHistory });

    for (const id of ["active", "speed", "distance", "efficiency"]) {
      expect(screen.getByTestId(`facet-${id}`)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId("shared-time-axis")).toHaveLength(1);
  });

  it("reports the source and sample count", () => {
    renderPanel({ summary, summaryHistory });
    expect(screen.getByText(/In-memory window · 3 samples/)).toBeInTheDocument();
  });

  it("offers a table view of the same series", async () => {
    const user = userEvent.setup();
    renderPanel({ summary, summaryHistory });

    await user.click(screen.getByRole("button", { name: "table" }));

    expect(screen.queryByTestId("facet-speed")).not.toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(4); // header + 3 samples
    expect(rows[1]).toHaveTextContent("32.0");
  });

  it("renders per-fleet rows with their own trend", () => {
    renderPanel({
      summary,
      summaryHistory,
      fleetHistory: new Map([["alpha", [makeFleet(), makeFleet({ avgSpeed: 33 })]]]),
    });

    const card = screen.getByTestId("fleet-alpha");
    expect(card).toHaveTextContent("alpha");
    expect(card.querySelector("[data-testid='sparkline']")).toBeTruthy();
  });

  it("resets analytics on demand", async () => {
    const user = userEvent.setup();
    renderPanel({ summary, summaryHistory });

    await user.click(screen.getByRole("button", { name: "Reset" }));
    expect(resetAnalytics).toHaveBeenCalledTimes(1);
  });
});

describe("AnalyticsPanel — persisted history", () => {
  function makeRow(index: number): AnalyticsHistoryRow {
    return {
      id: index,
      timestamp: new Date(T0 + index * 60_000).toISOString(),
      summary: makeSummary(index, { timestamp: T0 + index * 60_000 }),
      fleets: [makeFleet({ avgSpeed: 20 + index })],
    };
  }

  it("queries the stored series when a range is picked", async () => {
    const user = userEvent.setup();
    const fetchHistory = vi.fn().mockResolvedValue({ data: [makeRow(0), makeRow(1), makeRow(2)] });
    renderPanel({ summary: makeSummary(0), summaryHistory: [makeSummary(0)], fetchHistory });

    await user.click(screen.getByRole("tab", { name: "6h" }));

    await waitFor(() => expect(fetchHistory).toHaveBeenCalledTimes(1));
    const call = fetchHistory.mock.calls[0][0];
    expect(typeof call.from).toBe("string");
    expect(Date.parse(call.from)).not.toBeNaN();
    expect(call.limit).toBeGreaterThan(0);

    await screen.findByText(/Stored history · 3 samples/);
    expect(screen.getByTestId("facet-speed")).toBeInTheDocument();
  });

  it("derives the fleet breakdown from the stored rows", async () => {
    const user = userEvent.setup();
    const fetchHistory = vi.fn().mockResolvedValue({ data: [makeRow(0), makeRow(1)] });
    renderPanel({ summary: makeSummary(0), summaryHistory: [makeSummary(0)], fetchHistory });

    await user.click(screen.getByRole("tab", { name: "1h" }));
    const card = await screen.findByTestId("fleet-alpha");
    expect(card).toHaveTextContent("21.0"); // avgSpeed of the newest stored row
  });

  it("says persistence is off rather than silently showing the live window", async () => {
    const user = userEvent.setup();
    const fetchHistory = vi.fn().mockResolvedValue({
      error: "GET /analytics/history failed with status 503",
    });
    renderPanel({ summary: makeSummary(0), summaryHistory: [makeSummary(0)], fetchHistory });

    await user.click(screen.getByRole("tab", { name: "24h" }));

    expect(await screen.findByText(/running without persistence/i)).toBeInTheDocument();
    expect(screen.queryByTestId("facet-speed")).not.toBeInTheDocument();
  });

  it("surfaces a transport failure as an error, not as empty data", async () => {
    const user = userEvent.setup();
    const fetchHistory = vi.fn().mockResolvedValue({ error: "Failed to fetch" });
    renderPanel({ summary: makeSummary(0), summaryHistory: [makeSummary(0)], fetchHistory });

    await user.click(screen.getByRole("tab", { name: "1h" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Failed to fetch");
  });

  it("returns to the in-memory window when Live is reselected", async () => {
    const user = userEvent.setup();
    const fetchHistory = vi.fn().mockResolvedValue({ data: [] });
    const summaryHistory = [makeSummary(0), makeSummary(1)];
    renderPanel({ summary: summaryHistory[1], summaryHistory, fetchHistory });

    await user.click(screen.getByRole("tab", { name: "1h" }));
    await screen.findByText(/No stored samples/i);

    await user.click(screen.getByRole("tab", { name: "Live" }));
    expect(await screen.findByText(/In-memory window · 2 samples/)).toBeInTheDocument();
  });
});
