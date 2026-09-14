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
import { passthroughGuard, renderDockShell, type DockShellProps } from "@/test/dockProps";
import { DOCK_SECTIONS, rollUpBadge, type DockBadges } from "./dockSections";
import { CONSOLE_MIN_WIDTH } from "@/shell/Console/useConsoleSize";

// The keys and the console they open are one surface — see `DockShell`.
function renderDock(overrides: Partial<DockShellProps> = {}) {
  return renderDockShell(overrides);
}

const pill = (name: string) => screen.getByRole("button", { name });
const expanded = (name: string) => pill(name).getAttribute("aria-expanded") === "true";
const tabNames = () => screen.queryAllByRole("tab").map((t) => t.textContent?.trim());

const wingColumn = () => document.querySelector("[data-dock-wing='sections']") as HTMLElement;
const wingKeys = () =>
  Array.from(document.querySelectorAll("[data-dock='sections'] button")).map((b) =>
    b.getAttribute("aria-label")
  );

describe("the section wing's place on the row", () => {
  /**
   * The wing used to be packed against the deck (`justify-start` in its column),
   * so it slid left and right by ~100px every time the deck changed width —
   * entering dispatch swaps the live run's keys for a much wider mode rail, and
   * the discard prompt is wider again. Four keys that move whenever something
   * else happens are four keys muscle memory can't hold. It is now pinned to the
   * viewport's right edge, which nothing on the deck can reach.
   *
   * jsdom has no layout, so this asserts the rule (the alignment class) and the
   * consequence (same keys, same order) rather than measuring pixels.
   */
  it("hangs off the viewport's right edge, not off the deck's", () => {
    renderDock();
    expect(wingColumn().className).toContain("justify-end");
    expect(wingColumn().className).not.toContain("justify-start");
  });

  it("takes its outer margin from the shell grid, not from its own insets", () => {
    renderDock();
    // The one 12px margin now lives on the grid that holds every edge-anchored
    // surface (see `ShellGrid`), so the row is in flow inside the bottom track
    // rather than pinned to the map with insets of its own.
    const row = wingColumn().parentElement as HTMLElement;
    expect(row.className).not.toContain("absolute");
    expect(row.className).not.toContain("inset-x-3");
    expect(row.className).not.toContain("bottom-3");
    // The three-column template is the part that is still the row's own: it is
    // what holds the deck on the viewport's centre line.
    expect(row.className).toContain("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]");
  });

  it("keeps the same four keys in the same order whatever the deck is doing", () => {
    const live = renderDock();
    expect(wingKeys()).toEqual(["Fleet", "Monitor", "Session", "Settings"]);
    live.unmount();

    // Mid-mode: the deck is carrying a mode rail instead of the run's keys.
    const inMode = renderDock({
      modeDescriptor: {
        kind: "drawZone",
        label: "Heat zone",
        tone: "accent",
        status: "Drawing",
        actions: [],
      } as unknown as DockProps["modeDescriptor"],
    });
    expect(wingColumn().className).toContain("justify-end");
    expect(wingKeys()).toEqual(["Fleet", "Monitor", "Session", "Settings"]);
    inMode.unmount();

    // Being asked to discard: the deck becomes a prompt, wider again.
    renderDock({
      guard: { ...passthroughGuard(), pending: { loses: "4-point zone", run: vi.fn() } },
    });
    expect(wingColumn().className).toContain("justify-end");
    expect(wingKeys()).toEqual(["Fleet", "Monitor", "Session", "Settings"]);
  });
});

describe("dock section row", () => {
  it("rests as four labelled pills, none expanded", () => {
    renderDock();

    for (const section of DOCK_SECTIONS) {
      expect(pill(section.label)).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });

  it("opens the selected key's panel, with that section's views in its header", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(pill("Monitor"));

    // The key stays a key — it lights up rather than becoming something else.
    expect(pill("Monitor")).toHaveAttribute("aria-expanded", "true");
    expect(tabNames()).toEqual([
      "Incidents",
      "Events",
      "Analytics",
      "Geofences",
      "Heat zones",
      "Faults",
    ]);

    // …and the views live in the panel, not in the bar: the wing is always the
    // four keys, whatever is open.
    const panel = screen.getByRole("region", { name: "Monitor" });
    expect(within(panel).getAllByRole("tab")).toHaveLength(6);
    const wing = document.querySelector('[data-dock="sections"]') as HTMLElement;
    expect(within(wing).getAllByRole("button")).toHaveLength(4);
    expect(within(wing).queryAllByRole("tab")).toHaveLength(0);
  });

  it("keeps the wing's four keys the same shape whichever section is open", async () => {
    const user = userEvent.setup();
    renderDock();

    const wing = document.querySelector('[data-dock="sections"]') as HTMLElement;
    const names = () =>
      within(wing)
        .getAllByRole("button")
        .map((b) => `${b.getAttribute("aria-label")}:${b.getAttribute("aria-expanded")}`);

    expect(names()).toEqual(["Fleet:false", "Monitor:false", "Session:false", "Settings:false"]);

    await user.click(pill("Monitor"));
    // One key lights; nothing is added, removed or reordered around it.
    expect(names()).toEqual(["Fleet:false", "Monitor:true", "Session:false", "Settings:false"]);

    await user.click(pill("Settings"));
    expect(names()).toEqual(["Fleet:false", "Monitor:false", "Session:false", "Settings:true"]);
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

  it("gives the panel one header: the section, its views, and the way out", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(pill("Session"));

    const panel = await screen.findByRole("region", { name: "Session" });
    expect(panel).toHaveAttribute("id", "console-panel");
    // The eyebrow that used to repeat the lit view ("SESSION › RECORDINGS") is
    // gone: the header names the section once and the tab strip says the rest.
    expect(panel).not.toHaveTextContent("›");
    expect(
      within(panel)
        .getAllByRole("tab")
        .map((t) => t.textContent)
    ).toEqual(["Recordings", "Scenarios"]);

    await user.click(within(panel).getByRole("button", { name: "Close Session" }));
    expect(expanded("Session")).toBe(false);
  });

  it("gives Monitor's six views room to spell themselves out", async () => {
    const user = userEvent.setup();
    renderDock();

    await user.click(pill("Monitor"));
    const panel = await screen.findByRole("region", { name: "Monitor" });

    // One width for every section, wide enough for the longest header: the
    // At 460px "Faults" clipped
    // to "Fau" the moment the Incidents badge appeared.
    // Width is the operator's now, not the section's: the console is dragged
    // to taste and remembered (see `useConsoleSize`). What the suite can still
    // pin is that it opens wide enough for the widest header — Monitor's, with
    // a title, five tabs, a badge and a close button.
    expect(Number.parseInt(panel.style.width, 10)).toBeGreaterThanOrEqual(CONSOLE_MIN_WIDTH);
    expect(
      within(panel)
        .getAllByRole("tab")
        .map((t) => t.textContent)
    ).toEqual(["Incidents", "Events", "Analytics", "Geofences", "Heat zones", "Faults"]);
    // Tabs never shrink or wrap — a clipped tab is worse than a tight strip.
    for (const tab of within(panel).getAllByRole("tab")) {
      expect(tab.className).toContain("shrink-0");
      expect(tab.className).toContain("whitespace-nowrap");
    }
  });

  it("opens one floating surface at a time: launcher, tempo, or a section", async () => {
    const user = userEvent.setup();
    renderDock();

    const launcher = () => screen.getByRole("button", { name: "Start a map action" });
    const tempo = () => screen.getByRole("button", { name: /^Tempo/ });
    const isOpen = (b: HTMLElement) => b.getAttribute("aria-expanded") === "true";

    await user.click(launcher());
    expect(isOpen(launcher())).toBe(true);

    // Tempo takes the launcher away…
    await user.click(tempo());
    expect(isOpen(tempo())).toBe(true);
    expect(isOpen(launcher())).toBe(false);

    // …a section takes tempo away…
    await user.click(pill("Fleet"));
    expect(expanded("Fleet")).toBe(true);
    expect(isOpen(tempo())).toBe(false);
    expect(isOpen(launcher())).toBe(false);

    // …and the launcher collapses the section.
    await user.click(launcher());
    expect(isOpen(launcher())).toBe(true);
    expect(expanded("Fleet")).toBe(false);
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
