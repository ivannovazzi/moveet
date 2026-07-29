import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SESSION_EVENTS, sessionEventStore, type SessionEventInput } from "./sessionEventStore";

function incident(overrides: Partial<SessionEventInput> = {}): SessionEventInput {
  return { category: "incident", at: 1_000, label: "accident incident", ...overrides };
}

beforeEach(() => {
  sessionEventStore.reset();
});

describe("sessionEventStore", () => {
  it("keeps events oldest → newest with stable ids", () => {
    sessionEventStore.record(incident({ at: 1 }));
    sessionEventStore.record(incident({ at: 2, category: "dispatch", label: "dispatched" }));

    const events = sessionEventStore.all();
    expect(events.map((e) => e.at)).toEqual([1, 2]);
    expect(events.map((e) => e.category)).toEqual(["incident", "dispatch"]);
    expect(new Set(events.map((e) => e.id)).size).toBe(2);
  });

  it("is bounded and evicts the oldest events first", () => {
    for (let i = 0; i < MAX_SESSION_EVENTS + 50; i++) {
      sessionEventStore.record(incident({ at: i, label: `event ${i}` }));
    }

    const events = sessionEventStore.all();
    expect(events).toHaveLength(MAX_SESSION_EVENTS);
    // The first 50 were dropped; the newest is still there.
    expect(events[0].label).toBe("event 50");
    expect(events[events.length - 1].label).toBe(`event ${MAX_SESSION_EVENTS + 49}`);
  });

  it("never grows past the cap however long the session runs", () => {
    for (let i = 0; i < MAX_SESSION_EVENTS * 10; i++) {
      sessionEventStore.record(incident({ at: i }));
      expect(sessionEventStore.size()).toBeLessThanOrEqual(MAX_SESSION_EVENTS);
    }
    expect(sessionEventStore.size()).toBe(MAX_SESSION_EVENTS);
  });

  it("publishes a new array reference so external-store consumers re-render", () => {
    const before = sessionEventStore.all();
    sessionEventStore.record(incident());
    expect(sessionEventStore.all()).not.toBe(before);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = sessionEventStore.subscribe(listener);

    sessionEventStore.record(incident());
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    sessionEventStore.record(incident());
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("drops the buffer when the timeline changes — live and a recording are different axes", () => {
    sessionEventStore.record(incident());
    expect(sessionEventStore.size()).toBe(1);

    sessionEventStore.setTimeline("replay:run-1.ndjson");
    expect(sessionEventStore.size()).toBe(0);

    sessionEventStore.record(incident({ replayTime: 5_000 }));
    sessionEventStore.setTimeline("replay:run-2.ndjson");
    expect(sessionEventStore.size()).toBe(0);
  });

  it("keeps the buffer when the timeline is re-declared unchanged", () => {
    sessionEventStore.setTimeline("replay:run-1.ndjson");
    sessionEventStore.record(incident({ replayTime: 1_000 }));

    sessionEventStore.setTimeline("replay:run-1.ndjson");

    expect(sessionEventStore.size()).toBe(1);
  });
});
