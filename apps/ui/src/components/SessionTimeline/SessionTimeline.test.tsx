import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, fireEvent, within } from "@testing-library/react";
import type { ReplayStatus } from "@/types";
import SessionTimeline, { EMPTY_COPY, elapsedLabel } from "./SessionTimeline";
import { sessionEventStore, type SessionEventInput } from "./sessionEventStore";

/** Wall clock the whole suite mounts at: one minute past the epoch. */
const NOW = 60_000;

/** Local-time `HH:MM`, computed independently of the component's own helper. */
function hhmm(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const LIVE: ReplayStatus = { mode: "live" };
const REPLAY: ReplayStatus = {
  mode: "replay",
  file: "run-1.ndjson",
  duration: 60_000,
  currentTime: 15_000,
  speed: 1,
  paused: false,
};

function setup(replayStatus: ReplayStatus = LIVE) {
  const onSeek = vi.fn();
  const onSelectVehicle = vi.fn();
  const utils = render(
    <SessionTimeline
      replayStatus={replayStatus}
      onSeek={onSeek}
      onSelectVehicle={onSelectVehicle}
    />
  );
  return { ...utils, onSeek, onSelectVehicle };
}

function seed(...events: SessionEventInput[]) {
  for (const event of events) sessionEventStore.record(event);
}

/** Ticks, in render order. */
function ticks() {
  return within(screen.getByRole("group", { name: "Session events" })).queryAllByRole("button");
}

const categories = () => ticks().map((t) => t.getAttribute("data-category"));

/** `left: NN%` as a number. */
const leftPct = (el: HTMLElement) => Number.parseFloat(el.style.left);

beforeEach(() => {
  // The live axis runs session-start → now, so every position assertion needs a
  // pinned wall clock (and the strip's once-a-second tick needs fake timers).
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sessionEventStore.reset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionTimeline rendering", () => {
  it("shows an empty state before anything has happened", () => {
    setup();
    expect(ticks()).toHaveLength(0);
    expect(screen.getByText(EMPTY_COPY)).toBeInTheDocument();
  });

  it("renders a tick per event, tagged by category", () => {
    seed(
      { category: "incident", at: 1_000, label: "accident incident" },
      { category: "geofence-enter", at: 2_000, label: "Van 1 entered CBD", vehicleId: "v1" },
      { category: "geofence-exit", at: 3_000, label: "Van 1 exited CBD", vehicleId: "v1" },
      { category: "dispatch", at: 4_000, label: "Vehicle dispatched", vehicleId: "v2" }
    );
    setup();

    expect(categories()).toEqual(["incident", "geofence-enter", "geofence-exit", "dispatch"]);
  });

  it("names each tick with its category, time and description", () => {
    seed({
      category: "incident",
      at: Date.parse("2026-01-01T08:30:05"),
      label: "accident incident",
    });
    setup();

    expect(
      screen.getByRole("button", { name: "Incident · 08:30:05 — accident incident" })
    ).toBeInTheDocument();
  });

  it("places live ticks proportionally on a start-to-now axis", () => {
    // 0s / 15s / 30s into a session that is now 60s old, so the span is 60s and
    // the ticks sit at 0 / 25 / 50 percent — proportional to REAL elapsed time,
    // not stretched to fill the strip.
    seed(
      { category: "incident", at: 0, label: "a" },
      { category: "incident", at: 15_000, label: "b" },
      { category: "incident", at: 30_000, label: "c" }
    );
    setup();

    expect(ticks().map(leftPct)).toEqual([0, 25, 50]);
  });

  it("holds the axis at a one-minute floor while the session is younger", () => {
    // Twenty seconds in, a (max - min) axis would throw two ticks a few seconds
    // apart to opposite ends of the strip and imply they were far apart.
    vi.setSystemTime(20_000);
    seed(
      { category: "incident", at: 0, label: "a" },
      { category: "incident", at: 15_000, label: "b" }
    );
    setup();

    expect(ticks().map(leftPct)).toEqual([0, 25]);
  });

  it("grows the axis as the session outruns the floor", () => {
    vi.setSystemTime(120_000);
    seed(
      { category: "incident", at: 0, label: "a" },
      { category: "incident", at: 60_000, label: "b" }
    );
    setup();

    expect(ticks().map(leftPct)).toEqual([0, 50]);
  });

  it("re-scales on its own clock, without a new event", () => {
    seed(
      { category: "incident", at: 0, label: "a" },
      { category: "incident", at: 30_000, label: "b" }
    );
    setup();
    expect(ticks().map(leftPct)).toEqual([0, 50]);

    // A minute later nothing has happened, but "now" has moved, so the same
    // events sit earlier on a longer axis.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(ticks().map(leftPct)).toEqual([0, 25]);
  });

  it("anchors the axis at mount when no event is older", () => {
    // Mounted at NOW with nothing recorded: the axis starts now, not at 1970.
    setup();

    expect(screen.getByTestId("session-timeline-axis-start")).toHaveTextContent(hhmm(NOW));
    expect(screen.getByTestId("session-timeline-elapsed")).toHaveTextContent("00:00");
  });

  it("labels both ends of the live axis with wall-clock time", () => {
    seed({ category: "incident", at: 0, label: "a" });
    setup();

    expect(screen.getByTestId("session-timeline-axis-start")).toHaveTextContent(hhmm(0));
    expect(screen.getByTestId("session-timeline-axis-end")).toHaveTextContent(hhmm(NOW));
    expect(screen.getByTestId("session-timeline-now")).toBeInTheDocument();
  });

  it("labels the replay axis with recording offsets instead", () => {
    setup(REPLAY);

    expect(screen.getByTestId("session-timeline-axis-start")).toHaveTextContent("00:00");
    expect(screen.getByTestId("session-timeline-axis-end")).toHaveTextContent("01:00");
    expect(screen.queryByTestId("session-timeline-now")).not.toBeInTheDocument();
  });

  it("shows elapsed session time, and the replay position while replaying", () => {
    seed({ category: "incident", at: 0, label: "a" });
    const { unmount } = setup();
    // Session began at 0, clock is at NOW.
    expect(screen.getByTestId("session-timeline-elapsed")).toHaveTextContent("01:00");
    unmount();

    setup(REPLAY);
    // 15s into the recording.
    expect(screen.getByTestId("session-timeline-elapsed")).toHaveTextContent("00:15");
  });

  it("widens the elapsed readout only once there is an hour to show", () => {
    expect(elapsedLabel(0)).toBe("00:00");
    expect(elapsedLabel(754_000)).toBe("12:34");
    expect(elapsedLabel(3_754_000)).toBe("1:02:34");
    expect(elapsedLabel(-5_000)).toBe("00:00");
  });

  it("places replay ticks at their offset into the recording", () => {
    seed(
      { category: "incident", at: 1_000, replayTime: 0, label: "a" },
      { category: "incident", at: 2_000, replayTime: 30_000, label: "b" },
      { category: "incident", at: 3_000, replayTime: 60_000, label: "c" }
    );
    setup(REPLAY);

    expect(ticks().map(leftPct)).toEqual([0, 50, 100]);
  });
});

describe("SessionTimeline seeking", () => {
  it("seeks replay to the tick's moment on click", () => {
    seed({ category: "incident", at: 1_000, replayTime: 42_000, label: "accident incident" });
    const { onSeek, onSelectVehicle } = setup(REPLAY);

    fireEvent.click(ticks()[0]);

    expect(onSeek).toHaveBeenCalledWith(42_000);
    expect(onSelectVehicle).not.toHaveBeenCalled();
  });

  it("marks itself seekable and shows the playhead during a replay", () => {
    setup(REPLAY);

    expect(screen.getByRole("region", { name: "Session timeline" })).toHaveAttribute(
      "data-seekable"
    );
    expect(screen.getByText("Seek")).toBeInTheDocument();
    // 15s of a 60s recording.
    expect(leftPct(screen.getByTestId("session-timeline-playhead"))).toBe(25);
  });

  it("labels every tick as seekable while replaying", () => {
    seed({ category: "dispatch", at: 1_000, replayTime: 5_000, label: "Vehicle dispatched" });
    setup(REPLAY);

    expect(ticks()[0]).toHaveAttribute("aria-label", expect.stringContaining("(seek here)"));
    expect(ticks()[0]).toHaveAttribute("aria-label", expect.stringContaining("00:05"));
  });
});

describe("SessionTimeline during a live session", () => {
  it("says Live and offers no playhead — there is nothing to seek to", () => {
    setup(LIVE);

    const region = screen.getByRole("region", { name: "Session timeline" });
    expect(region).not.toHaveAttribute("data-seekable");
    expect(screen.getByText("Live")).toBeInTheDocument();
    expect(screen.queryByTestId("session-timeline-playhead")).not.toBeInTheDocument();
  });

  it("selects the tick's vehicle instead of seeking", () => {
    seed({ category: "dispatch", at: 1_000, label: "Vehicle dispatched", vehicleId: "v7" });
    const { onSeek, onSelectVehicle } = setup(LIVE);

    fireEvent.click(ticks()[0]);

    expect(onSelectVehicle).toHaveBeenCalledWith("v7");
    expect(onSeek).not.toHaveBeenCalled();
  });

  it("dims and disables ticks with no vehicle to fall back to", () => {
    seed(
      { category: "incident", at: 1_000, label: "accident incident" },
      { category: "dispatch", at: 2_000, label: "Vehicle dispatched", vehicleId: "v7" }
    );
    const { onSeek, onSelectVehicle } = setup(LIVE);

    const [incidentTick, dispatchTick] = ticks();
    expect(incidentTick).toHaveAttribute("aria-disabled", "true");
    expect(dispatchTick).not.toHaveAttribute("aria-disabled");

    fireEvent.click(incidentTick);
    expect(onSeek).not.toHaveBeenCalled();
    expect(onSelectVehicle).not.toHaveBeenCalled();
  });

  it("treats a replay with no duration as not seekable", () => {
    seed({ category: "incident", at: 1_000, replayTime: 500, label: "accident incident" });
    const { onSeek } = setup({ mode: "replay", file: "run-1.ndjson", duration: 0 });

    fireEvent.click(ticks()[0]);

    expect(onSeek).not.toHaveBeenCalled();
    expect(screen.getByText("Live")).toBeInTheDocument();
  });
});

describe("SessionTimeline buffering", () => {
  it("retains only the newest events and says how many it dropped", () => {
    for (let i = 0; i < 260; i++) {
      seed({ category: "incident", at: 1_000 + i, label: `incident ${i}` });
    }
    setup();

    // 260 events one millisecond apart all land inside one quantum, so they
    // collapse into a single marker rather than 200 unreachable stacked ones.
    const marker = ticks()[0];
    expect(marker).toHaveAttribute("data-count", "200");
    expect(marker).toHaveAttribute("aria-label", expect.stringContaining("incident 60"));
    expect(marker).toHaveAttribute("aria-label", expect.not.stringContaining("incident 59"));

    // And the drop is visible rather than silent.
    expect(screen.getByTestId("session-timeline-evicted")).toHaveTextContent("+60 earlier");
  });

  it("shows no eviction badge while everything still fits", () => {
    seed({ category: "incident", at: 1_000, label: "a" });
    setup();

    expect(screen.queryByTestId("session-timeline-evicted")).not.toBeInTheDocument();
  });
});

describe("SessionTimeline clustering", () => {
  it("merges ticks that would overlap into one counted marker", () => {
    // A burst: five crossings inside half a second, which at a 60s window all
    // land within the overlap threshold and would otherwise stack.
    for (let i = 0; i < 5; i++) {
      seed({
        category: "geofence-enter",
        at: 1_000 + i * 100,
        label: `crossing ${i}`,
        vehicleId: `v${i}`,
      });
    }
    setup();

    expect(ticks()).toHaveLength(1);
    expect(ticks()[0]).toHaveAttribute("data-count", "5");
    expect(ticks()[0]).toHaveAttribute("aria-label", expect.stringContaining("5 events"));
  });

  it("keeps well-separated events as individual ticks", () => {
    seed(
      { category: "incident", at: 0, label: "a" },
      { category: "incident", at: 30_000, label: "b" }
    );
    setup();

    expect(ticks()).toHaveLength(2);
    expect(ticks()[0]).not.toHaveAttribute("data-count");
  });

  it("steps through every event in a merged marker on repeated clicks", () => {
    // This is the whole point of clustering: before it, the last-rendered
    // button swallowed the click and the rest were unreachable.
    for (let i = 0; i < 3; i++) {
      seed({
        category: "geofence-enter",
        at: 1_000 + i * 100,
        label: `crossing ${i}`,
        vehicleId: `v${i}`,
      });
    }
    const { onSelectVehicle } = setup();

    fireEvent.click(ticks()[0]);
    fireEvent.click(ticks()[0]);
    fireEvent.click(ticks()[0]);
    fireEvent.click(ticks()[0]);

    expect(onSelectVehicle.mock.calls.map(([id]) => id)).toEqual(["v0", "v1", "v2", "v0"]);
  });

  it("takes the worst category present as the marker's colour", () => {
    seed(
      { category: "dispatch", at: 1_000, label: "d", vehicleId: "v1" },
      { category: "incident", at: 1_100, label: "i" },
      { category: "geofence-exit", at: 1_200, label: "g", vehicleId: "v2" }
    );
    setup();

    expect(ticks()[0]).toHaveAttribute("data-category", "incident");
  });

  it("skips unreachable members when stepping through a merged marker", () => {
    // Incidents have no vehicle, so live they are not selectable — cycling
    // must not stall on them.
    seed(
      { category: "incident", at: 1_000, label: "i" },
      { category: "dispatch", at: 1_100, label: "d", vehicleId: "v9" }
    );
    const { onSelectVehicle } = setup();

    fireEvent.click(ticks()[0]);
    fireEvent.click(ticks()[0]);

    expect(onSelectVehicle.mock.calls.map(([id]) => id)).toEqual(["v9", "v9"]);
  });
});
