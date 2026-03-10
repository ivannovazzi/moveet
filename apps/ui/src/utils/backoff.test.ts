import { describe, it, expect } from "vitest";
import { calculateBackoffDelay, INITIAL_RECONNECT_DELAY, MAX_RECONNECT_DELAY } from "./backoff";

describe("calculateBackoffDelay", () => {
  it("returns initial delay for first attempt", () => {
    expect(calculateBackoffDelay(0)).toBe(INITIAL_RECONNECT_DELAY);
  });

  it("doubles delay with each attempt", () => {
    expect(calculateBackoffDelay(0)).toBe(1000);
    expect(calculateBackoffDelay(1)).toBe(2000);
    expect(calculateBackoffDelay(2)).toBe(4000);
    expect(calculateBackoffDelay(3)).toBe(8000);
  });

  it("caps at max delay", () => {
    expect(calculateBackoffDelay(10)).toBe(MAX_RECONNECT_DELAY);
    expect(calculateBackoffDelay(20)).toBe(MAX_RECONNECT_DELAY);
  });

  it("respects custom initial delay", () => {
    expect(calculateBackoffDelay(0, 500)).toBe(500);
    expect(calculateBackoffDelay(1, 500)).toBe(1000);
  });

  it("respects custom max delay", () => {
    expect(calculateBackoffDelay(10, 1000, 5000)).toBe(5000);
  });
});
