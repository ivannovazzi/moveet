import { describe, it, expect, vi } from "vitest";
import { SimulationClock } from "../modules/SimulationClock";

describe("SimulationClock", () => {
  describe("tick advancement and speed multiplier", () => {
    it("tick(3600_000) at speedMultiplier=1 advances by exactly 1 hour", () => {
      const clock = new SimulationClock({ startHour: 7 });
      clock.tick(3_600_000);
      expect(clock.getHour()).toBe(8);
    });

    it("tick(3600_000) at speedMultiplier=2 advances by 2 hours", () => {
      const clock = new SimulationClock({ startHour: 7, speedMultiplier: 2 });
      clock.tick(3_600_000);
      expect(clock.getHour()).toBe(9);
    });

    it("tick(1800_000) at speedMultiplier=2 advances by exactly 1 hour", () => {
      const clock = new SimulationClock({ startHour: 7, speedMultiplier: 2 });
      clock.tick(1_800_000);
      expect(clock.getHour()).toBe(8);
    });

    it("tick does nothing when speedMultiplier is 0", () => {
      const clock = new SimulationClock({ startHour: 12 });
      clock.setSpeedMultiplier(0);
      clock.tick(3_600_000);
      expect(clock.getHour()).toBe(12);
    });

    it("multiple ticks accumulate correctly", () => {
      const clock = new SimulationClock({ startHour: 6 });
      for (let i = 0; i < 3; i++) clock.tick(3_600_000);
      expect(clock.getHour()).toBe(9);
    });
  });

  describe("hour:changed event emission", () => {
    it("emits hour:changed when crossing an hour boundary", () => {
      const clock = new SimulationClock({ startHour: 7 });
      const handler = vi.fn();
      clock.on("hour:changed", handler);
      clock.tick(3_600_000);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(8, "morning_rush");
    });

    it("does NOT emit hour:changed when staying within the same hour", () => {
      const clock = new SimulationClock({ startHour: 7 });
      const handler = vi.fn();
      clock.on("hour:changed", handler);
      clock.tick(1_800_000); // only 30 minutes
      expect(handler).not.toHaveBeenCalled();
    });

    it("emits once per hour boundary crossed", () => {
      const clock = new SimulationClock({ startHour: 7 });
      const handler = vi.fn();
      clock.on("hour:changed", handler);
      clock.tick(1_800_000); // 30 min → still hour 7
      clock.tick(1_800_000); // 30 min → crosses to hour 8
      expect(handler).toHaveBeenCalledOnce();
    });

    it("emits the correct timeOfDay with the hour:changed event", () => {
      const clock = new SimulationClock({ startHour: 16 });
      const handler = vi.fn();
      clock.on("hour:changed", handler);
      clock.tick(3_600_000); // → hour 17 (evening_rush)
      expect(handler).toHaveBeenCalledWith(17, "evening_rush");
    });
  });

  describe("getTimeOfDay() for all time ranges", () => {
    it("returns morning_rush at hour 7", () => {
      const clock = new SimulationClock({ startHour: 7 });
      expect(clock.getTimeOfDay()).toBe("morning_rush");
    });

    it("returns morning_rush at hour 8", () => {
      const clock = new SimulationClock({ startHour: 8 });
      expect(clock.getTimeOfDay()).toBe("morning_rush");
    });

    it("returns midday at hour 9 (boundary, end of morning_rush)", () => {
      const clock = new SimulationClock({ startHour: 9 });
      expect(clock.getTimeOfDay()).toBe("midday");
    });

    it("returns midday at hour 12", () => {
      const clock = new SimulationClock({ startHour: 12 });
      expect(clock.getTimeOfDay()).toBe("midday");
    });

    it("returns evening_rush at hour 17", () => {
      const clock = new SimulationClock({ startHour: 17 });
      expect(clock.getTimeOfDay()).toBe("evening_rush");
    });

    it("returns evening_rush at hour 18", () => {
      const clock = new SimulationClock({ startHour: 18 });
      expect(clock.getTimeOfDay()).toBe("evening_rush");
    });

    it("returns midday at hour 19 (boundary, end of evening_rush)", () => {
      const clock = new SimulationClock({ startHour: 19 });
      expect(clock.getTimeOfDay()).toBe("midday");
    });

    it("returns night at hour 22", () => {
      const clock = new SimulationClock({ startHour: 22 });
      expect(clock.getTimeOfDay()).toBe("night");
    });

    it("returns night at hour 2", () => {
      const clock = new SimulationClock({ startHour: 2 });
      expect(clock.getTimeOfDay()).toBe("night");
    });

    it("returns night at hour 0", () => {
      const clock = new SimulationClock({ startHour: 0 });
      expect(clock.getTimeOfDay()).toBe("night");
    });

    it("returns midday at hour 5 (boundary, end of night)", () => {
      const clock = new SimulationClock({ startHour: 5 });
      expect(clock.getTimeOfDay()).toBe("midday");
    });
  });

  describe("API: setSpeedMultiplier, setTime, reset", () => {
    it("setSpeedMultiplier changes the multiplier immediately", () => {
      const clock = new SimulationClock({ startHour: 7 });
      clock.setSpeedMultiplier(3);
      clock.tick(3_600_000);
      expect(clock.getHour()).toBe(10); // 3 hours forward
    });

    it("setSpeedMultiplier(0) freezes time", () => {
      const clock = new SimulationClock({ startHour: 7 });
      clock.setSpeedMultiplier(0);
      clock.tick(100_000_000);
      expect(clock.getHour()).toBe(7);
    });

    it("setSpeedMultiplier throws for negative values", () => {
      const clock = new SimulationClock({ startHour: 7 });
      expect(() => clock.setSpeedMultiplier(-1)).toThrow();
    });

    it("setTime jumps to the new time", () => {
      const clock = new SimulationClock({ startHour: 7 });
      const newTime = new Date();
      newTime.setHours(15, 0, 0, 0);
      clock.setTime(newTime);
      expect(clock.getHour()).toBe(15);
    });

    it("setTime emits hour:changed when hour changes", () => {
      const clock = new SimulationClock({ startHour: 7 });
      const handler = vi.fn();
      clock.on("hour:changed", handler);
      const newTime = new Date();
      newTime.setHours(15, 0, 0, 0);
      clock.setTime(newTime);
      expect(handler).toHaveBeenCalledOnce();
      expect(handler).toHaveBeenCalledWith(15, "midday");
    });

    it("setTime does NOT emit hour:changed when hour stays the same", () => {
      const clock = new SimulationClock({ startHour: 7 });
      const handler = vi.fn();
      clock.on("hour:changed", handler);
      const sameHour = new Date();
      sameHour.setHours(7, 30, 0, 0);
      clock.setTime(sameHour);
      expect(handler).not.toHaveBeenCalled();
    });

    it("reset resets to hour 7 and speedMultiplier 1", () => {
      const clock = new SimulationClock({ startHour: 15, speedMultiplier: 5 });
      clock.reset();
      expect(clock.getHour()).toBe(7);
      expect(clock.getState().speedMultiplier).toBe(1);
    });
  });

  describe("fast-forward with large speedMultiplier", () => {
    it("large speedMultiplier jumps many hours in one tick", () => {
      const clock = new SimulationClock({ startHour: 0, speedMultiplier: 10 });
      clock.tick(3_600_000); // 1 real hour → 10 sim hours
      expect(clock.getHour()).toBe(10);
    });

    it("emits hour:changed at the final hour only (not all intermediate hours)", () => {
      // Each tick only detects the current hour vs last tracked hour
      const clock = new SimulationClock({ startHour: 0, speedMultiplier: 10 });
      let eventCount = 0;
      clock.on("hour:changed", () => eventCount++);
      clock.tick(3_600_000); // jumps from 0 → 10 in one call
      // Implementation emits once per tick (detects final crossing)
      expect(eventCount).toBe(1);
    });
  });

  describe("time jump behavior (setTime)", () => {
    it("setTime can jump backward in time", () => {
      const clock = new SimulationClock({ startHour: 15 });
      const earlier = new Date();
      earlier.setHours(6, 0, 0, 0);
      clock.setTime(earlier);
      expect(clock.getHour()).toBe(6);
    });

    it("setTime updates getTimeOfDay correctly after jump", () => {
      const clock = new SimulationClock({ startHour: 12 });
      const rushTime = new Date();
      rushTime.setHours(8, 0, 0, 0);
      clock.setTime(rushTime);
      expect(clock.getTimeOfDay()).toBe("morning_rush");
    });
  });

  describe("reset resets to default start time", () => {
    it("resets hour to 7 regardless of how far the clock has advanced", () => {
      const clock = new SimulationClock({ startHour: 7 });
      clock.tick(10 * 3_600_000); // advance 10 hours
      clock.reset();
      expect(clock.getHour()).toBe(7);
    });

    it("resets speedMultiplier to 1", () => {
      const clock = new SimulationClock({ startHour: 7, speedMultiplier: 100 });
      clock.reset();
      clock.tick(3_600_000);
      expect(clock.getHour()).toBe(8); // exactly 1 hour at x1
    });

    it("resets timeOfDay to morning_rush (hour 7)", () => {
      const clock = new SimulationClock({ startHour: 22 });
      clock.reset();
      expect(clock.getTimeOfDay()).toBe("morning_rush");
    });

    it("after reset, hour:changed fires again on next hour crossing", () => {
      const clock = new SimulationClock({ startHour: 7 });
      clock.tick(3_600_000); // → hour 8
      clock.reset(); // back to 7
      const handler = vi.fn();
      clock.on("hour:changed", handler);
      clock.tick(3_600_000); // → hour 8 again
      expect(handler).toHaveBeenCalledOnce();
    });
  });

  describe("getState() returns correct snapshot", () => {
    it("returns all four fields", () => {
      const clock = new SimulationClock({ startHour: 8, speedMultiplier: 2 });
      const state = clock.getState();
      expect(state).toHaveProperty("currentTime");
      expect(state).toHaveProperty("speedMultiplier");
      expect(state).toHaveProperty("hour");
      expect(state).toHaveProperty("timeOfDay");
    });

    it("currentTime is a Date instance", () => {
      const clock = new SimulationClock({ startHour: 7 });
      expect(clock.getState().currentTime).toBeInstanceOf(Date);
    });

    it("getState() reflects current hour and timeOfDay", () => {
      const clock = new SimulationClock({ startHour: 8, speedMultiplier: 2 });
      const state = clock.getState();
      expect(state.hour).toBe(8);
      expect(state.speedMultiplier).toBe(2);
      expect(state.timeOfDay).toBe("morning_rush");
    });

    it("getState() is a snapshot (does not mutate on further ticks)", () => {
      const clock = new SimulationClock({ startHour: 7 });
      const state = clock.getState();
      clock.tick(3_600_000); // advance to hour 8
      // The snapshot should still show hour 7
      expect(state.hour).toBe(7);
      expect(clock.getHour()).toBe(8);
    });

    it("getState() after reset shows hour 7 and multiplier 1", () => {
      const clock = new SimulationClock({ startHour: 18, speedMultiplier: 5 });
      clock.reset();
      const state = clock.getState();
      expect(state.hour).toBe(7);
      expect(state.speedMultiplier).toBe(1);
      expect(state.timeOfDay).toBe("morning_rush");
    });
  });
});
