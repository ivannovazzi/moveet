import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GameLoop } from "../modules/GameLoop";
import { VehicleRegistry } from "../modules/VehicleRegistry";
import { FleetManager } from "../modules/FleetManager";
import { SimulationClock } from "../modules/SimulationClock";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { Vehicle } from "../types";
import path from "path";
import logger from "../utils/logger";

// Mock logger to suppress output and allow assertions
vi.mock("../utils/logger", () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

const FIXTURE_PATH = path.join(__dirname, "fixtures", "test-network.geojson");

describe("GameLoop", () => {
  let network: RoadNetwork;
  let registry: VehicleRegistry;
  let fleetManager: FleetManager;
  let clock: SimulationClock;
  let gameLoop: GameLoop;
  let updateCalls: { id: string; deltaMs: number }[];
  let origVehicleCount: number;

  beforeEach(() => {
    origVehicleCount = config.vehicleCount;
    (config as any).vehicleCount = 3;

    network = new RoadNetwork(FIXTURE_PATH);
    fleetManager = new FleetManager();
    registry = new VehicleRegistry(network, fleetManager);
    clock = new SimulationClock({ startHour: 7, speedMultiplier: 1 });
    updateCalls = [];

    // Load vehicles
    registry.loadFromData();

    gameLoop = new GameLoop(
      registry,
      (vehicle: Vehicle, deltaMs: number) => {
        updateCalls.push({ id: vehicle.id, deltaMs });
      },
      fleetManager,
      clock
    );
  });

  afterEach(() => {
    (config as any).vehicleCount = origVehicleCount;
    gameLoop.stopGameLoop();
  });

  // ─── Activation / deactivation ────────────────────────────────────

  describe("vehicle activation", () => {
    it("should track active vehicles", () => {
      expect(gameLoop.getActiveVehicles().size).toBe(0);
      gameLoop.startVehicleMovement("0", 500);
      expect(gameLoop.getActiveVehicles().has("0")).toBe(true);
      expect(gameLoop.getActiveVehicles().size).toBe(1);
    });

    it("should remove vehicle from active set on stop", () => {
      gameLoop.startVehicleMovement("0", 500);
      gameLoop.stopVehicleMovement("0");
      expect(gameLoop.getActiveVehicles().has("0")).toBe(false);
    });

    it("should report isRunning correctly", () => {
      expect(gameLoop.isRunning()).toBe(false);
      gameLoop.startVehicleMovement("0", 500);
      expect(gameLoop.isRunning()).toBe(true);
      gameLoop.stopVehicleMovement("0");
      expect(gameLoop.isRunning()).toBe(false);
    });
  });

  // ─── Game loop lifecycle ──────────────────────────────────────────

  describe("game loop lifecycle", () => {
    it("should start game loop on first vehicle activation", () => {
      expect(gameLoop.getGameLoopIntervalRef()).toBeNull();
      gameLoop.startVehicleMovement("0", 500);
      expect(gameLoop.getGameLoopIntervalRef()).not.toBeNull();
    });

    it("should stop game loop when last vehicle is deactivated", () => {
      gameLoop.startVehicleMovement("0", 500);
      gameLoop.startVehicleMovement("1", 500);
      gameLoop.stopVehicleMovement("0");
      expect(gameLoop.getGameLoopIntervalRef()).not.toBeNull();
      gameLoop.stopVehicleMovement("1");
      expect(gameLoop.getGameLoopIntervalRef()).toBeNull();
    });

    it("should not create multiple intervals for multiple vehicles", () => {
      gameLoop.startVehicleMovement("0", 500);
      const firstInterval = gameLoop.getGameLoopIntervalRef();
      gameLoop.startVehicleMovement("1", 500);
      expect(gameLoop.getGameLoopIntervalRef()).toBe(firstInterval);
    });

    it("should restart when interval changes", () => {
      gameLoop.startVehicleMovement("0", 500);
      const firstInterval = gameLoop.getGameLoopIntervalRef();
      gameLoop.startVehicleMovement("1", 1000); // different interval
      expect(gameLoop.getGameLoopIntervalRef()).not.toBe(firstInterval);
    });

    it("should restart the running interval immediately when setGameLoopIntervalMs changes it, without needing a vehicle state change", () => {
      gameLoop.startVehicleMovement("0", 500);
      const firstInterval = gameLoop.getGameLoopIntervalRef();
      expect(gameLoop.getGameLoopIntervalMs()).toBe(500);

      gameLoop.setGameLoopIntervalMs(1000);

      expect(gameLoop.getGameLoopIntervalMs()).toBe(1000);
      // The underlying setInterval handle must be a new one — the change
      // takes effect immediately rather than waiting for the next
      // activation/deactivation.
      expect(gameLoop.getGameLoopIntervalRef()).not.toBe(firstInterval);
      expect(gameLoop.getGameLoopIntervalRef()).not.toBeNull();
      // Active vehicles must be preserved across the restart.
      expect(gameLoop.getActiveVehicles().has("0")).toBe(true);
    });

    it("should not restart the interval when setGameLoopIntervalMs is called with the loop stopped", () => {
      expect(gameLoop.getGameLoopIntervalRef()).toBeNull();

      gameLoop.setGameLoopIntervalMs(1000);

      expect(gameLoop.getGameLoopIntervalMs()).toBe(1000);
      expect(gameLoop.getGameLoopIntervalRef()).toBeNull();
    });

    it("should not restart the interval when setGameLoopIntervalMs is called with an unchanged value", () => {
      gameLoop.startVehicleMovement("0", 500);
      const firstInterval = gameLoop.getGameLoopIntervalRef();

      gameLoop.setGameLoopIntervalMs(500);

      expect(gameLoop.getGameLoopIntervalRef()).toBe(firstInterval);
    });
  });

  // ─── gameLoopTick ─────────────────────────────────────────────────

  describe("gameLoopTick", () => {
    it("should update all active vehicles", () => {
      const vehicles = Array.from(registry.getAll().values());
      for (const v of vehicles) {
        gameLoop.startVehicleMovement(v.id, 500);
      }

      gameLoop.gameLoopTick();

      expect(updateCalls).toHaveLength(vehicles.length);
      for (const v of vehicles) {
        expect(updateCalls.map((c) => c.id)).toContain(v.id);
      }
    });

    it("should only update active vehicles", () => {
      gameLoop.startVehicleMovement("0", 500);
      gameLoop.startVehicleMovement("1", 500);

      gameLoop.gameLoopTick();

      expect(updateCalls).toHaveLength(2);
      expect(updateCalls.map((c) => c.id)).toContain("0");
      expect(updateCalls.map((c) => c.id)).toContain("1");
      expect(updateCalls.map((c) => c.id)).not.toContain("2");
    });

    it("should compute correct deltaTime", () => {
      gameLoop.startVehicleMovement("0", 500);

      // Set known last update time
      const now = Date.now();
      gameLoop.getLastUpdateTimes().set("0", now - 250);

      gameLoop.gameLoopTick();

      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].deltaMs).toBeGreaterThanOrEqual(200);
      expect(updateCalls[0].deltaMs).toBeLessThan(1000);
    });

    it("should emit update events", () => {
      const vehicles = Array.from(registry.getAll().values());
      for (const v of vehicles) {
        gameLoop.startVehicleMovement(v.id, 500);
      }

      const updateEvents: string[] = [];
      gameLoop.on("update", (dto) => updateEvents.push(dto.id));

      gameLoop.gameLoopTick();

      expect(updateEvents).toHaveLength(vehicles.length);
    });

    it("should tick the simulation clock", () => {
      const clockTickSpy = vi.spyOn(clock, "tick");
      gameLoop.startVehicleMovement("0", 500);

      gameLoop.gameLoopTick();

      expect(clockTickSpy).toHaveBeenCalledTimes(1);
      clockTickSpy.mockRestore();
    });

    it("should clamp oversized deltas to 2x the loop interval and warn", () => {
      vi.mocked(logger.warn).mockClear();
      const clockTickSpy = vi.spyOn(clock, "tick");
      gameLoop.startVehicleMovement("0", 500);

      // Simulate a long stall (e.g. host sleep): timestamps far in the past
      const past = Date.now() - 60_000;
      (gameLoop as any).lastClockTick = past;
      gameLoop.getLastUpdateTimes().set("0", past);

      gameLoop.gameLoopTick();

      // Clock delta clamped to 2 × 500ms
      expect(clockTickSpy).toHaveBeenCalledTimes(1);
      expect(clockTickSpy.mock.calls[0][0]).toBeLessThanOrEqual(1000);

      // Per-vehicle delta clamped too
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].deltaMs).toBeLessThanOrEqual(1000);

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("clamping"));
      clockTickSpy.mockRestore();
    });

    it("should not clamp or warn for normal deltas", () => {
      vi.mocked(logger.warn).mockClear();
      gameLoop.startVehicleMovement("0", 500);
      gameLoop.getLastUpdateTimes().set("0", Date.now() - 250);

      gameLoop.gameLoopTick();

      expect(updateCalls[0].deltaMs).toBeGreaterThanOrEqual(200);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("should continue updating remaining vehicles when one update throws", () => {
      vi.mocked(logger.error).mockClear();
      gameLoop.updateVehicleFn = (vehicle: Vehicle, deltaMs: number) => {
        if (vehicle.id === "0") throw new Error("boom");
        updateCalls.push({ id: vehicle.id, deltaMs });
      };
      gameLoop.startVehicleMovement("0", 500);
      gameLoop.startVehicleMovement("1", 500);

      expect(() => gameLoop.gameLoopTick()).not.toThrow();

      expect(updateCalls.map((c) => c.id)).toContain("1");
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("vehicle 0"));
    });
  });

  // ─── reset ────────────────────────────────────────────────────────

  describe("reset", () => {
    it("should stop the game loop and clear all state", () => {
      gameLoop.startVehicleMovement("0", 500);
      gameLoop.startVehicleMovement("1", 500);
      expect(gameLoop.isRunning()).toBe(true);

      gameLoop.reset();

      expect(gameLoop.isRunning()).toBe(false);
      expect(gameLoop.getGameLoopIntervalRef()).toBeNull();
      expect(gameLoop.getActiveVehicles().size).toBe(0);
      expect(gameLoop.getLastUpdateTimes().size).toBe(0);
    });
  });
});
