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

  it("spreads live ticks across the retained window, oldest left / newest right", () => {
    seed(
      { category: "incident", at: 1_000, label: "a" },
      { category: "incident", at: 2_000, label: "b" },
      { category: "incident", at: 3_000, label: "c" }
    );
    setup();

    expect(ticks().map(leftPct)).toEqual([0, 50, 100]);
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
  it("renders no more ticks than the store retains", () => {
    for (let i = 0; i < 260; i++) {
      seed({ category: "incident", at: 1_000 + i, label: `incident ${i}` });
    }
    setup();

    expect(ticks()).toHaveLength(200);
    // The oldest were evicted, so the earliest surviving tick is #60.
    expect(ticks()[0]).toHaveAttribute("aria-label", expect.stringContaining("incident 60"));
  });
});
