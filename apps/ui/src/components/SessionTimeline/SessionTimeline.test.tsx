import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { ReplayStatus } from "@/types";
import SessionTimeline from "./SessionTimeline";
import { sessionEventStore, type SessionEventInput } from "./sessionEventStore";

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
  sessionEventStore.reset();
});

describe("SessionTimeline rendering", () => {
  it("shows an empty state before anything has happened", () => {
    setup();
    expect(ticks()).toHaveLength(0);
    expect(screen.getByText("No incidents, geofence events or dispatches yet")).toBeInTheDocument();
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

  it("places live ticks proportionally within a quantized window", () => {
    // 0s / 15s / 30s into a session. The window rounds up to one 60s quantum,
    // so these sit at 0 / 25 / 50 percent — proportional to REAL elapsed time,
    // not stretched to fill the strip.
    seed(
      { category: "incident", at: 0, label: "a" },
      { category: "incident", at: 15_000, label: "b" },
      { category: "incident", at: 30_000, label: "c" }
    );
    setup();

    expect(ticks().map(leftPct)).toEqual([0, 25, 50]);
  });

  it("does not move existing ticks when a later event arrives", () => {
    // The regression this guards: normalising by (max - min) rescaled the axis
    // on every event, so ticks slid left as the session ran and a position
    // stopped meaning anything.
    seed(
      { category: "incident", at: 0, label: "a" },
      { category: "incident", at: 15_000, label: "b" }
    );
    const { rerender } = setup();
    const before = ticks().map(leftPct);

    seed({ category: "incident", at: 30_000, label: "c" });
    rerender(<SessionTimeline replayStatus={LIVE} onSeek={vi.fn()} onSelectVehicle={vi.fn()} />);

    expect(ticks().map(leftPct).slice(0, 2)).toEqual(before);
  });

  it("reflows once when the session outgrows the current quantum", () => {
    seed(
      { category: "incident", at: 0, label: "a" },
      { category: "incident", at: 30_000, label: "b" }
    );
    const { rerender } = setup();
    expect(ticks().map(leftPct)).toEqual([0, 50]);

    // Crossing 60s doubles the window, so the 30s tick halves to 25%.
    seed({ category: "incident", at: 90_000, label: "c" });
    rerender(<SessionTimeline replayStatus={LIVE} onSeek={vi.fn()} onSelectVehicle={vi.fn()} />);

    expect(ticks().map(leftPct)).toEqual([0, 25, 75]);
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
