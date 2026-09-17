import { describe, expect, it } from "vitest";
import { formatArrivalTime, formatDuration } from "./duration";

describe("formatDuration", () => {
  it("uses seconds under a minute", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(0.4)).toBe("0 s");
  });

  it("uses whole minutes under an hour", () => {
    expect(formatDuration(60)).toBe("1 min");
    expect(formatDuration(12 * 60 + 20)).toBe("12 min");
  });

  it("splits hours and minutes above an hour", () => {
    expect(formatDuration(3600)).toBe("1 h");
    expect(formatDuration(3600 + 5 * 60)).toBe("1 h 5 min");
  });

  it("renders a gap, not a zero, for a missing or nonsensical value", () => {
    // The simulator omits the ETA entirely for an unrouted vehicle; "0 s" there
    // would read as "arriving now".
    expect(formatDuration(undefined)).toBe("—");
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(0)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("takes a caller-supplied empty rendering", () => {
    expect(formatDuration(undefined, "")).toBe("");
    expect(formatDuration(undefined, "none")).toBe("none");
  });
});

describe("formatArrivalTime", () => {
  const now = new Date("2026-09-17T09:00:00Z").getTime();

  it("adds the ETA to the current time", () => {
    const expected = new Date(now + 1800 * 1000).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(formatArrivalTime(1800, now)).toBe(expected);
  });

  it("renders zero seconds as the current time rather than a gap", () => {
    const expected = new Date(now).toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(formatArrivalTime(0, now)).toBe(expected);
  });

  it("renders a gap for a missing or nonsensical ETA", () => {
    expect(formatArrivalTime(undefined, now)).toBe("—");
    expect(formatArrivalTime(null, now)).toBe("—");
    expect(formatArrivalTime(-1, now)).toBe("—");
    expect(formatArrivalTime(Number.NaN, now)).toBe("—");
  });
});
