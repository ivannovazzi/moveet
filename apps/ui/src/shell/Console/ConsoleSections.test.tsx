import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
import { createDockProps, DockShell, type DockShellProps } from "@/test/dockProps";
import { useDockNavigation } from "@/hooks/useDockNavigation";
import { DOCK_SECTIONS, dockSection, INSPECT_SECTION } from "@/Dock/dockSections";
import { createPOI, createVehicle } from "@/test/mocks/types";

/**
 * Selection is a section of the console like any other — it just has no key on
 * the dock's wing, because it is where you already are rather than a place you
 * decide to go.
 */
function renderWithInspect(overrides: Partial<DockShellProps> = {}) {
  function Harness() {
    const navigation = useDockNavigation();
    return (
      <div>
        <button type="button" onClick={() => navigation.open("inspect")}>
          select something
        </button>
        <DockShell props={createDockProps(overrides)} navigation={navigation} />
      </div>
    );
  }
  return render(<Harness />);
}

const open = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: "select something" }));

describe("the Inspect section", () => {
  it("is a section the console can show, but not a key on the wing", () => {
    // A key for it would be lit-and-empty for most of a run, so it opens
    // because something was selected and never because it was pressed.
    expect(DOCK_SECTIONS.map((s) => s.id)).toEqual(["fleet", "monitor", "session", "settings"]);
    expect(dockSection("inspect")).toBe(INSPECT_SECTION);
  });

  it("opens on what the map has selected, and titles itself after it", async () => {
    const user = userEvent.setup();
    renderWithInspect({ inspector: { vehicle: createVehicle({ id: "v1", name: "Van 12" }) } });

    await open(user);

    // The console's header names the vehicle, not the section: "Van 12" is the
    // answer to why the view is open at all.
    expect(screen.getByRole("region", { name: "Van 12" })).toBeInTheDocument();
    expect(screen.getByText("v1")).toBeInTheDocument();
  });

  it("offers no tab strip, having one view", async () => {
    const user = userEvent.setup();
    renderWithInspect({ inspector: { poi: createPOI({ id: "p1", name: "Depot" }) } });

    await open(user);

    // A lone tab that is always selected reads as a button that does nothing.
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Depot" })).toBeInTheDocument();
  });

  it("stays open when the selection is cleared", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithInspect({
      inspector: { vehicle: createVehicle({ id: "v1", name: "Van 12" }) },
    });

    await open(user);
    expect(screen.getByRole("region", { name: "Van 12" })).toBeInTheDocument();

    // Escape clears the selection. The console has no other view to fall back
    // to, and a surface that vanished from under the operator would read as a
    // bug — so the section is the one allowed to render empty.
    rerender(<div />);
    renderWithInspect({ inspector: {} });
    await open(user);
    // Named for the section, with an empty body: the header is the message.
    const panel = screen.getByRole("region", { name: "Inspect" });
    expect(within(panel).getByRole("region", { name: "Inspector" })).toBeEmptyDOMElement();
  });

  it("closes from the console's own header, like any other section", async () => {
    const user = userEvent.setup();
    renderWithInspect({ inspector: { vehicle: createVehicle({ name: "Van 12" }) } });

    await open(user);
    await user.click(screen.getByRole("button", { name: "Close Van 12" }));

    expect(screen.queryByRole("region", { name: "Van 12" })).not.toBeInTheDocument();
  });
});
