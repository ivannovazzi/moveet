import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * The deck is the dock's contents, and it is derived from what the operator is
 * doing. These tests *are* the model: for each activity, exactly which keys are
 * on the bar. That is the part worth pinning — a control that lingers into an
 * activity it cannot serve (record while placing a job, tempo during a replay, a
 * live play button while a recording plays) is the failure mode this replaced.
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
    actions: [{ label: "Undo point", run: vi.fn(), enabled: true }],
    primary: { label: "Finish zone", run: vi.fn(), enabled: true },
    exit: vi.fn(),
    exitLabel: "Cancel",
    busy: false,
    dirty: "4-point zone",
    locksPan: false,
    ...overrides,
  };
}

function dispatchMode(overrides: Partial<ModeDescriptor> = {}): ModeDescriptor {
  return {
    kind: "dispatch",
    label: "Dispatch",
    icon: null,
    tone: "accent",
    status: "3 selected",
    actions: [{ label: "Clear", run: vi.fn(), enabled: true }],
    exit: vi.fn(),
    exitLabel: "Exit",
    busy: false,
    dirty: "3 selected vehicles",
    locksPan: false,
    ...overrides,
  };
}

const replaying: ReplayStatus = {
  mode: "replay",
  paused: false,
  file: "runs/morning.jsonl",
  currentTime: 30_000,
  duration: 120_000,
  speed: 2,
};

function renderDock(
  props: {
    modeDescriptor?: ModeDescriptor | null;
    guard?: ModeGuard;
    replayStatus?: ReplayStatus;
    isRecording?: boolean;
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
          ...(props.isRecording !== undefined ? { isRecording: props.isRecording } : {}),
          ...(props.onStartMode ? { onStartMode: props.onStartMode } : {}),
        })}
        navigation={navigation}
      />
    );
  }
  return render(<Harness />);
}

const deck = () => document.querySelector('[data-dock="deck"]') as HTMLElement;
const activity = () => deck().getAttribute("data-activity");

/** Every key on the deck, by accessible name (falling back to its label text). */
function deckKeys(): string[] {
  return within(deck())
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? b.textContent?.trim() ?? "");
}

const hasKey = (pattern: RegExp) => deckKeys().some((k) => pattern.test(k));

const LAUNCHER = /^Start a map action$/;
const PLAY = /simulation$/;
const RESET = /^Reset$/;
const RECORD = /recording$/;
const TEMPO = /^Tempo/;

/** The four section keys are never an activity's business — they stay put. */
function expectSectionsReachable() {
  for (const name of ["Fleet", "Monitor", "Session", "Settings"]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
}

describe("dock deck", () => {
  describe("watching the live run", () => {
    it("offers the way in and the run's own controls, and nothing else", () => {
      renderDock();

      expect(activity()).toBe("live");
      expect(deckKeys()).toEqual([
        expect.stringMatching(LAUNCHER),
        expect.stringMatching(PLAY),
        expect.stringMatching(RESET),
        expect.stringMatching(RECORD),
        expect.stringMatching(TEMPO),
      ]);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    });

    it("lists every map mode with its shortcut behind the one launcher", async () => {
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

  describe("making something on the map", () => {
    it("swaps the run's controls for the mode's own keys", () => {
      renderDock({ modeDescriptor: drawZoneMode() });

      expect(activity()).toBe("mode");
      // The mode's keys, and only those: undo the last point, finish, cancel.
      expect(deckKeys()).toEqual(["Undo point", "Finish zone⏎", "CancelEsc"]);
      // Nothing left over from watching the run.
      expect(hasKey(LAUNCHER)).toBe(false);
      expect(hasKey(PLAY)).toBe(false);
      expect(hasKey(RECORD)).toBe(false);
      expect(hasKey(TEMPO)).toBe(false);
    });

    it("states the mode and its progress without a sentence of prose", () => {
      renderDock({ modeDescriptor: drawZoneMode() });

      expect(screen.getByRole("status").textContent).toBe(
        "Draw zone4 pointsUndo pointFinish zone⏎CancelEsc"
      );
    });

    it("keeps time control for dispatch, which rides the live run", () => {
      renderDock({ modeDescriptor: dispatchMode() });

      expect(activity()).toBe("mode");
      expect(hasKey(PLAY)).toBe(true);
      expect(hasKey(TEMPO)).toBe(true);
      // …but not the keys that belong to starting or capturing work.
      expect(hasKey(LAUNCHER)).toBe(false);
      expect(hasKey(RECORD)).toBe(false);
      expect(deckKeys()).toContain("Clear");
    });

    it("runs a mode's side action", async () => {
      const undo = vi.fn();
      const user = userEvent.setup();
      renderDock({
        modeDescriptor: drawZoneMode({
          actions: [{ label: "Undo point", run: undo, enabled: true }],
        }),
      });

      await user.click(screen.getByRole("button", { name: "Undo point" }));

      expect(undo).toHaveBeenCalledOnce();
    });

    it("disables a side action the mode says has nothing to act on", () => {
      renderDock({
        modeDescriptor: drawZoneMode({
          status: "0 points",
          actions: [{ label: "Undo point", run: vi.fn(), enabled: false }],
        }),
      });

      expect(screen.getByRole("button", { name: "Undo point" })).toBeDisabled();
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

    it("keeps a capture stoppable even where the activity would drop the key", () => {
      renderDock({ modeDescriptor: drawZoneMode(), isRecording: true });

      // A recording nobody can stop from the dock is worse than one extra key.
      expect(hasKey(/^Stop recording$/)).toBe(true);
    });

    it("leaves the section keys where they were", () => {
      renderDock({ modeDescriptor: drawZoneMode() });
      expectSectionsReachable();
    });
  });

  describe("asked to discard in-flight work", () => {
    const guard = (loses: string): ModeGuard => ({
      pending: { loses, run: vi.fn() },
      request: vi.fn(),
      confirm: vi.fn(),
      dismiss: vi.fn(),
    });

    it("reduces the dock to the question and its two answers", () => {
      renderDock({ modeDescriptor: drawZoneMode(), guard: guard("4-point zone") });

      expect(activity()).toBe("guard");
      expect(screen.getByRole("alertdialog", { name: "Confirm discard" })).toBeInTheDocument();
      expect(screen.getByText("Discard 4-point zone?")).toBeInTheDocument();
      expect(deckKeys()).toEqual(["Keep", "Discard"]);
    });

    it("keeps the work when dismissed and drops it when confirmed", async () => {
      const g = guard("half-placed job");
      const user = userEvent.setup();
      renderDock({ guard: g });

      await user.click(screen.getByRole("button", { name: "Keep" }));
      expect(g.dismiss).toHaveBeenCalledOnce();

      await user.click(screen.getByRole("button", { name: "Discard" }));
      expect(g.confirm).toHaveBeenCalledOnce();
    });
  });

  describe("replaying a recording", () => {
    it("becomes the playback's transport instead of showing a second one", () => {
      renderDock({ replayStatus: replaying });

      expect(activity()).toBe("replay");
      expect(screen.getByRole("button", { name: "Pause replay" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Stop replay" })).toBeInTheDocument();
      expect(screen.getByRole("slider", { name: "Replay position" })).toBeInTheDocument();
      expect(screen.getByText("00:30 / 02:00")).toBeInTheDocument();

      // The live run's keys are gone rather than sitting there disabled: none of
      // them steers a recording.
      expect(hasKey(PLAY)).toBe(false);
      expect(hasKey(RESET)).toBe(false);
      expect(hasKey(TEMPO)).toBe(false);
      expect(hasKey(LAUNCHER)).toBe(false);
    });

    it("leaves the section keys where they were", () => {
      renderDock({ replayStatus: replaying });
      expectSectionsReachable();
    });
  });
});
