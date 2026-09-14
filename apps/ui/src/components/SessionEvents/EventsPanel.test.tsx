import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EventsPanel from "./EventsPanel";
import { sessionEventStore, type SessionEventInput } from "./sessionEventStore";
import type { ReplayStatus } from "@/types";

/**
 * The session's events as a log.
 *
 * They used to be ticks on a time axis along the bottom of the app. That is the
 * right shape for a recording and the wrong one for a live session: a live
 * session cannot be scrubbed, so the axis was unreadable and each tick was an
 * unlabelled mark you had to hover to identify. The store is unchanged — this
 * is the same data, in the shape it always was.
 */
const LIVE: ReplayStatus = { mode: "live" };
const REPLAY: ReplayStatus = { mode: "replay", file: "run.ndjson" };

function record(input: Partial<SessionEventInput> = {}) {
  sessionEventStore.record({
    category: "incident",
    at: Date.UTC(2026, 0, 1, 9, 30, 15),
    label: "Collision on Ngong Road",
    ...input,
  } as SessionEventInput);
}

function renderPanel(replayStatus: ReplayStatus = LIVE) {
  const onSeek = vi.fn();
  const onSelectVehicle = vi.fn();
  render(
    <EventsPanel replayStatus={replayStatus} onSeek={onSeek} onSelectVehicle={onSelectVehicle} />
  );
  return { onSeek, onSelectVehicle };
}

const rows = () => screen.getAllByRole("listitem");

beforeEach(() => sessionEventStore.reset());

describe("the session event log", () => {
  it("says what it is waiting for when nothing has happened", () => {
    renderPanel();
    expect(screen.getByText(/no events yet/i)).toBeInTheDocument();
  });

  it("puts the newest event first", () => {
    record({ label: "First thing", at: 1000 });
    record({ label: "Second thing", at: 2000 });
    renderPanel();

    // The question this answers is "what just happened", and the answer should
    // not be at the bottom of a list that grows all session.
    expect(within(rows()[0]).getByText("Second thing")).toBeInTheDocument();
    expect(within(rows()[1]).getByText("First thing")).toBeInTheDocument();
  });

  it("names each event's category rather than colouring it and hoping", () => {
    record({ category: "geofence-enter", label: "Van 12 entered Westlands" });
    record({ category: "dispatch", label: "3 vehicles dispatched" });
    renderPanel();

    expect(screen.getByText("Geofence in")).toBeInTheDocument();
    expect(screen.getByText("Dispatch")).toBeInTheDocument();
  });

  it("selects the vehicle an event belongs to, live", async () => {
    const user = userEvent.setup();
    record({ label: "Van 12 entered Westlands", vehicleId: "v12" });
    const { onSelectVehicle } = renderPanel(LIVE);

    await user.click(screen.getByRole("button", { name: /Van 12 entered Westlands/ }));
    expect(onSelectVehicle).toHaveBeenCalledWith("v12");
  });

  it("seeks the recording to the moment an event describes, replaying", async () => {
    const user = userEvent.setup();
    record({ label: "Collision on Ngong Road", vehicleId: "v12", replayTime: 92_000 });
    const { onSeek, onSelectVehicle } = renderPanel(REPLAY);

    await user.click(screen.getByRole("button", { name: /Collision on Ngong Road/ }));
    expect(onSeek).toHaveBeenCalledWith(92_000);
    // Seeking is the whole point of a recording; selecting is the live fallback.
    expect(onSelectVehicle).not.toHaveBeenCalled();
  });

  it("is a readout, not a control, for an event with nowhere to go", () => {
    record({ label: "2 vehicles dispatched", category: "dispatch" });
    renderPanel(LIVE);

    // No vehicle to select and no offset to seek to. A button that did nothing
    // would be worse than a line of text.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("2 vehicles dispatched")).toBeInTheDocument();
  });

  it("owns up to what fell out of its window", () => {
    for (let i = 0; i < 205; i++) record({ label: `Event ${i}`, at: 1000 + i });
    renderPanel();

    // A bounded window that silently discards its own history is a log that
    // lies about its extent.
    expect(screen.getByText(/5 earlier events dropped/i)).toBeInTheDocument();
  });
});
