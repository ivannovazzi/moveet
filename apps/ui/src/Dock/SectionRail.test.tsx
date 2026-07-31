import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The dynamic dock: sections live on the row rather than inside the dock, and
 * selecting one turns that pill into its own dock whose buttons are its tabs.
 * These pin the properties that make the row worth trusting — a section always
 * expands to the same buttons, the main dock never moves, and nothing else
 * becomes unreachable while a section is expanded.
 */

vi.mock("@/utils/client", async () => {
  const { createMockClient } = await import("@/test/mocks/client");
  return {
    default: {
      ...createMockClient(),
      getClock: vi.fn().mockResolvedValue({ data: undefined }),
      getGenerateStatus: vi.fn().mockResolvedValue({ data: undefined }),
      onGenerateProgress: vi.fn(),
      offGenerateProgress: vi.fn(),
      onGenerateComplete: vi.fn(),
      offGenerateComplete: vi.fn(),
      onGenerateError: vi.fn(),
      offGenerateError: vi.fn(),
      getScenarios: vi.fn().mockResolvedValue({ data: [] }),
      getScenarioStatus: vi.fn().mockResolvedValue({ data: undefined }),
      onScenarioEvent: vi.fn(),
      offScenarioEvent: vi.fn(),
    },
  };
});

vi.mock("@/Controls/Adapter/adapterClient", () => ({
  getHealth: vi.fn(() => Promise.reject(new Error("offline"))),
  getConfig: vi.fn(() => Promise.reject(new Error("offline"))),
  setSource: vi.fn(),
  addSink: vi.fn(),
  removeSink: vi.fn(),
  setRealism: vi.fn(),
}));

// Imported after the mocks so the hoisted factories are in place.
import Dock, { type DockProps } from "./Dock";
import { useDockNavigation } from "@/hooks/useDockNavigation";
import { createDockProps } from "@/test/dockProps";
import { DOCK_SECTIONS, rollUpBadge, type DockBadges } from "./dockSections";

function renderDock(overrides: Partial<Omit<DockProps, "navigation">> = {}) {
  function Harness() {
    const navigation = useDockNavigation();
    return <Dock {...createDockProps(overrides)} navigation={navigation} />;
  }
  return render(<Harness />);
}

const pill = (name: string) => screen.getByRole("button", { name });
const expanded = (name: string) => pill(name).getAttribute("aria-expanded") === "true";
const tabNames = () => screen.queryAllByRole("tab").map((t) => t.textContent?.trim());

describe("dock section row", () => {
  it("rests as four labelled pills, none expanded", () => {
    renderDock();

    for (const section of DOCK_SECTIONS) {
      expect(pill(section.label)).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("unfolds the selected key's own buttons beside it", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(pill("Monitor"));

    // The key stays a key — it lights up rather than becoming something else.
    expect(pill("Monitor")).toHaveAttribute("aria-expanded", "true");
    expect(tabNames()).toEqual(["Incidents", "Analytics", "Geofences", "Heat zones", "Faults"]);
  });

  it("collapses from the lit key it expanded from", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(pill("Monitor"));
    expect(expanded("Monitor")).toBe(true);

    // The section's buttons carry no close button; the key is the way back.
    await user.click(pill("Monitor"));

    expect(expanded("Monitor")).toBe(false);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("expands to the same buttons every time, whatever the state", async () => {
    const user = userEvent.setup();
    renderDock({
      incidents: {
        incidents: [
          { id: "i1", type: "accident", position: [0, 0], severity: "high" },
        ] as unknown as DockProps["incidents"]["incidents"],
        createRandom: async () => {},
        remove: async () => {},
        error: null,
      },
    });

    await user.click(pill("Monitor"));
    const withIncident = tabNames();
    await user.click(pill("Monitor"));
    await user.click(pill("Monitor"));

    expect(tabNames()).toEqual(withIncident);
  });

  it("opens on the section's first button, then remembers where you were", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(pill("Monitor"));
    expect(screen.getByRole("tab", { name: /Incidents/ })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("tab", { name: /Faults/ }));
    await user.click(pill("Monitor"));
    await user.click(pill("Monitor"));

    expect(screen.getByRole("tab", { name: /Faults/ })).toHaveAttribute("aria-selected", "true");
  });

  it("keeps the other sections one click away while one is expanded", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(pill("Monitor"));
    await user.click(pill("Session"));

    expect(expanded("Session")).toBe(true);
    expect(expanded("Monitor")).toBe(false);
    expect(tabNames()).toEqual(["Recordings", "Scenarios"]);
  });

  it("never hides the main dock's controls behind an expanded section", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(pill("Fleet"));

    expect(screen.getByRole("button", { name: "Pause simulation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Tempo/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start a map action" })).toBeInTheDocument();
  });

  it("anchors the panel to the section that opened it", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(pill("Session"));

    const panel = await screen.findByRole("region", { name: "Session" });
    expect(within(panel).queryAllByRole("tab")).toHaveLength(0);
    expect(panel).toHaveAttribute("id", "dock-section-panel");
  });

  it("badges the tab that owns the count, and rolls it up onto the collapsed pill", async () => {
    const user = userEvent.setup();
    renderDock({
      faults: {
        faults: {
          config: { enabled: true, vehicles: {} },
          status: {
            enabled: true,
            devices: 3,
            frozen: 2,
            teleporting: 0,
            dead: 1,
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
          },
          loading: false,
          error: null,
          configure: async () => {},
          setVehicleProfile: async () => {},
          clearVehicleProfile: async () => {},
          reset: async () => {},
        },
        vehicles: [],
      } as unknown as DockProps["faults"],
    });

    // Collapsed: the count rolls up onto the Monitor pill.
    expect(pill("Monitor")).toHaveTextContent("3");

    await user.click(pill("Monitor"));

    // Expanded: it moves to the button it actually belongs to, and stops being
    // counted twice on the key above it.
    expect(screen.getByRole("tab", { name: /Faults/ })).toHaveTextContent("3");
    expect(screen.getByRole("tab", { name: /Incidents/ })).not.toHaveTextContent("3");
    expect(pill("Monitor")).not.toHaveTextContent("3");
  });
});

describe("rollUpBadge", () => {
  it("lets an error count outrank an informational one", () => {
    const badges: DockBadges = {
      dispatch: { count: 7, tone: "accent", label: "7 selected" },
      jobs: { count: 1, tone: "error", label: "1 past SLA" },
    };

    expect(rollUpBadge("fleet", badges)?.label).toBe("1 past SLA");
  });

  it("takes the larger of two counts in the same tone", () => {
    const badges: DockBadges = {
      incidents: { count: 2, tone: "error", label: "2 incidents" },
      faults: { count: 5, tone: "error", label: "5 devices" },
    };

    expect(rollUpBadge("monitor", badges)?.label).toBe("5 devices");
  });

  it("is undefined when the section is quiet", () => {
    expect(rollUpBadge("settings", {})).toBeUndefined();
    expect(
      rollUpBadge("fleet", { jobs: { count: 0, tone: "error", label: "none" } })
    ).toBeUndefined();
  });
});
