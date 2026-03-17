import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GameLoop } from "../modules/GameLoop";
import { VehicleRegistry } from "../modules/VehicleRegistry";
import { FleetManager } from "../modules/FleetManager";
import { SimulationClock } from "../modules/SimulationClock";
import { RoadNetwork } from "../modules/RoadNetwork";
import { config } from "../utils/config";
import type { Vehicle } from "../types";
import path from "path";

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
