import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigResponse, HealthResponse } from "./adapterClient";

/**
 * Regression cover for fleetsim-all-8lcy ("Adapter sheet close race clobbers
 * next panel selection").
 *
 * The original bug lived in the pre-dock nav-rail: `AdapterDrawer` was a Radix
 * `Sheet` wired as `onClose={closePanel}`, so clicking a different nav item set
 * `activePanel` to the new panel and *then* the closing Sheet fired
 * `onOpenChange(false)` -> `closePanel()` -> `activePanel = null`. The click
 * looked like a no-op and had to be repeated.
 *
 * That drawer no longer exists — the adapter UI is now `FeedsSection`, a tab of
 * the Settings panel rendered into the single shared `DockPanel`, and switching
 * clusters is one
 * `setOpenCluster` call. These tests pin that behaviour so the race cannot be
 * reintroduced: a close handler must never run as a side effect of a panel
 * switch, while a genuine outside click must still close. (Escape now closes
 * the panel through the app's single keyboard dispatcher — see
 * useInteractionMode.test.ts — not through DockPanel.)
 */

vi.mock("@/utils/client", async () => {
  const { createMockClient } = await import("@/test/mocks/client");
  return {
    default: {
      ...createMockClient(),
      getClock: vi.fn().mockResolvedValue({ data: undefined }),
    },
  };
});

const health: HealthResponse = {
  source: { type: "simulator", healthy: true },
  sinks: [{ type: "kafka", healthy: true }],
  availableSources: [],
  availableSinks: [],
};

const config: ConfigResponse = {
  activeSource: "simulator",
  activeSinks: ["kafka"],
  sourceConfig: {},
  sinkConfig: {},
  status: health,
};

vi.mock("./adapterClient", () => ({
  getHealth: vi.fn(() => Promise.resolve(health)),
  getConfig: vi.fn(() => Promise.resolve(config)),
  setSource: vi.fn(),
  addSink: vi.fn(),
  removeSink: vi.fn(),
  setRealism: vi.fn(),
}));

// Imported after the mocks so the hoisted factories are in place.
import Dock, { type DockProps } from "@/Dock/Dock";
import { useDockNavigation } from "@/hooks/useDockNavigation";
import { createDockProps } from "@/test/dockProps";

/**
 * Drawer state lives in App now (so Escape can route through the one keyboard
 * dispatcher), so supply it the same way App does.
 */
function DockHarness(props: Omit<DockProps, "navigation">) {
  const navigation = useDockNavigation();
  return <Dock {...props} navigation={navigation} />;
}

/**
 * Open the view the adapter UI now lives in. "Sinks & Source" stopped being its
 * own cluster: feed health reads on the status chips, and the configuration is
 * the Settings dock's "Feeds & sinks" button.
 */
async function openAdapterPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Settings" }));
  expect(await screen.findByRole("region", { name: "Settings" })).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Feeds & sinks" }));
}

/** The section key itself carries `aria-expanded`, open or not. */
const sectionKey = (name: string) => screen.getByRole("button", { name });

describe("adapter panel <-> other panel switching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("switches from the adapter panel to Monitor in a single click", async () => {
    const user = userEvent.setup();
    render(<DockHarness {...createDockProps()} />);

    await openAdapterPanel(user);
    expect(sectionKey("Settings")).toHaveAttribute("aria-expanded", "true");

    // One click on a different cluster must land on that cluster. The bug was
    // that the adapter drawer's own close handler fired afterwards and reset
    // the selection back to "nothing open".
    await user.click(screen.getByRole("button", { name: "Monitor" }));

    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();
    expect(sectionKey("Monitor")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Settings" })).toHaveAttribute(
      "aria-expanded",
      "false"
    );
    expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument();

    // Still open a tick later — a deferred close would show up here.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByRole("region", { name: "Monitor" })).toBeInTheDocument();
  });

  it("switches from the adapter panel to Tempo details in a single click", async () => {
    const user = userEvent.setup();
    render(<DockHarness {...createDockProps()} />);

    await openAdapterPanel(user);

    await user.click(screen.getByRole("button", { name: /Tempo/ }));

    expect(await screen.findByRole("region", { name: "Tempo" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument();
  });

  it("switches back into the adapter panel from another panel in a single click", async () => {
    const user = userEvent.setup();
    render(<DockHarness {...createDockProps()} />);

    await user.click(screen.getByRole("button", { name: "Monitor" }));
    expect(await screen.findByRole("region", { name: "Monitor" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));

    expect(await screen.findByRole("region", { name: "Settings" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Monitor" })).not.toBeInTheDocument();
  });

  it("still closes the adapter panel when its own section is collapsed", async () => {
    const user = userEvent.setup();
    render(<DockHarness {...createDockProps()} />);

    await openAdapterPanel(user);
    await user.click(sectionKey("Settings"));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument()
    );
  });

  it("still closes the adapter panel on a genuine outside click", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">outside</button>
        <DockHarness {...createDockProps()} />
      </div>
    );

    await openAdapterPanel(user);
    await user.click(screen.getByRole("button", { name: "outside" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Settings" })).not.toBeInTheDocument()
    );
  });
});
