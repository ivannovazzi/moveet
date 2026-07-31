import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The dock's centre slot is the one thing that changes with what the operator
 * is doing. These pin the behaviour the old dock got wrong: a mode with no
 * visible way out (heat zones), two surfaces telling the same dispatch story in
 * different words, and a replay that took the whole bar away.
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

vi.mock("@/Controls/Adapter/adapterClient", () => ({
  getHealth: vi.fn(() => Promise.reject(new Error("offline"))),
  getConfig: vi.fn(() => Promise.reject(new Error("offline"))),
  setSource: vi.fn(),
  addSink: vi.fn(),
  removeSink: vi.fn(),
  setRealism: vi.fn(),
}));

// Imported after the mocks so the hoisted factories are in place.
import Dock from "./Dock";
import { useDockNavigation } from "@/hooks/useDockNavigation";
import { createDockProps, passthroughGuard } from "@/test/dockProps";
import type { ModeDescriptor } from "./modeDescriptors";
import type { ModeGuard } from "@/hooks/useModeGuard";
import type { ReplayStatus } from "@/types";

function drawZoneMode(overrides: Partial<ModeDescriptor> = {}): ModeDescriptor {
  return {
    kind: "draw-geofence",
    label: "Draw zone",
    icon: null,
    tone: "accent",
    status: "4 points",
    hint: "Click the first point to close",
    primary: { label: "Finish zone", run: vi.fn(), enabled: true },
    exit: vi.fn(),
    exitLabel: "Cancel",
    busy: false,
    dirty: "4-point zone",
    locksPan: false,
    ...overrides,
  };
}

function renderDock(
  props: {
    modeDescriptor?: ModeDescriptor | null;
    guard?: ModeGuard;
    replayStatus?: ReplayStatus;
    onStartMode?: (kind: string) => void;
  } = {}
) {
  function Harness() {
    const navigation = useDockNavigation();
    return (
      <Dock
        {...createDockProps({
          modeDescriptor: props.modeDescriptor ?? null,
          guard: props.guard ?? passthroughGuard(),
          replayStatus: props.replayStatus ?? { mode: "live" },
          ...(props.onStartMode ? { onStartMode: props.onStartMode } : {}),
        })}
        navigation={navigation}
      />
    );
  }
  return render(<Harness />);
}

/** The clusters must stay reachable in every centre-slot state. */
function expectClustersPresent() {
  for (const name of ["Fleet", "Monitor", "Session", "Settings"]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
}

describe("dock centre slot", () => {
  describe("browsing", () => {
    it("closes the centre slot when nothing is going on", () => {
      renderDock();

      // Idle, the main dock is transport and tempo only — no parked control.
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("offers one launcher listing every map mode with its shortcut", async () => {
      const user = userEvent.setup();
      renderDock();

      await user.click(screen.getByRole("button", { name: "Start a map action" }));

      for (const label of ["Dispatch vehicles", "New job", "Draw geofence", "Draw heat zone"]) {
        expect(screen.getByRole("button", { name: new RegExp(label) })).toBeInTheDocument();
      }
    });

    it("starts the chosen mode", async () => {
      const onStartMode = vi.fn();
      const user = userEvent.setup();
      renderDock({ onStartMode });

      await user.click(screen.getByRole("button", { name: "Start a map action" }));
      await user.click(screen.getByRole("button", { name: /Draw heat zone/ }));

      expect(onStartMode).toHaveBeenCalledWith("draw-heatzone");
    });

    it("cannot start anything while the simulator is unreachable", () => {
      function Harness() {
        const navigation = useDockNavigation();
        return <Dock {...createDockProps({ connected: false })} navigation={navigation} />;
      }
      render(<Harness />);

      expect(screen.getByRole("button", { name: "Start a map action" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Pause simulation" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
    });
  });

  describe("in a mode", () => {
    it("states the mode, its progress and what to do next", () => {
      renderDock({ modeDescriptor: drawZoneMode() });

      expect(screen.getByText("Draw zone")).toBeInTheDocument();
      expect(screen.getByText("4 points")).toBeInTheDocument();
      expect(screen.getByText("Click the first point to close")).toBeInTheDocument();
    });

    it("always offers an exit, so a mode can never be orphaned", async () => {
      const exit = vi.fn();
      const user = userEvent.setup();
      renderDock({ modeDescriptor: drawZoneMode({ exit }) });

      await user.click(screen.getByRole("button", { name: /Cancel/ }));

      expect(exit).toHaveBeenCalledOnce();
    });

    it("disables the primary action until the mode says it is ready", () => {
      renderDock({
        modeDescriptor: drawZoneMode({
          primary: { label: "Finish zone", run: vi.fn(), enabled: false },
        }),
      });

      expect(screen.getByRole("button", { name: /Finish zone/ })).toBeDisabled();
    });

    it("locks nothing else away — the clusters are still there", () => {
      renderDock({ modeDescriptor: drawZoneMode() });
      expectClustersPresent();
    });
  });

  describe("pending discard", () => {
    it("asks in the centre slot, naming what would be lost", () => {
      const guard: ModeGuard = {
        pending: { loses: "4-point zone", run: vi.fn() },
        request: vi.fn(),
        confirm: vi.fn(),
        dismiss: vi.fn(),
      };
      renderDock({ modeDescriptor: drawZoneMode(), guard });

      expect(screen.getByRole("alertdialog", { name: "Confirm discard" })).toBeInTheDocument();
      expect(screen.getByText("Discard 4-point zone?")).toBeInTheDocument();
    });

    it("keeps the work when dismissed and drops it when confirmed", async () => {
      const confirm = vi.fn();
      const dismiss = vi.fn();
      const guard: ModeGuard = {
        pending: { loses: "half-placed job", run: vi.fn() },
        request: vi.fn(),
        confirm,
        dismiss,
      };
      const user = userEvent.setup();
      renderDock({ guard });

      await user.click(screen.getByRole("button", { name: "Keep" }));
      expect(dismiss).toHaveBeenCalledOnce();

      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(confirm).toHaveBeenCalledOnce();
    });
  });

  describe("replaying", () => {
    const replayStatus: ReplayStatus = {
      mode: "replay",
      paused: false,
      file: "runs/morning.jsonl",
      currentTime: 30_000,
      duration: 120_000,
      speed: 2,
    };

    it("runs the playback from the centre slot", () => {
      renderDock({ replayStatus });

      expect(screen.getByRole("button", { name: "Pause replay" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Stop replay" })).toBeInTheDocument();
      expect(screen.getByRole("slider", { name: "Replay position" })).toBeInTheDocument();
      expect(screen.getByText("00:30 / 02:00")).toBeInTheDocument();
    });

    it("keeps the rest of the dock reachable (the old ReplayDock replaced it)", () => {
      renderDock({ replayStatus });

      expectClustersPresent();
      expect(screen.getByRole("button", { name: /Tempo/ })).toBeInTheDocument();
    });

    it("quietens tempo, which steers the live clock rather than the playback", () => {
      renderDock({ replayStatus });

      expect(screen.getByRole("button", { name: /Tempo/ })).toBeDisabled();
    });
  });
});
