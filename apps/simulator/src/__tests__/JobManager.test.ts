import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import type { DirectionResult, JobDTO, VehicleDTO, Waypoint } from "@moveet/shared-types";
import { JobManager, type JobVehicleGateway } from "../modules/JobManager";

/**
 * A stand-in for VehicleManager: an EventEmitter carrying a vehicle roster plus
 * scripted routing results. Lets the lifecycle be driven by emitting the same
 * `waypoint:reached` / `route:completed` events RouteManager emits, with no road
 * network or pathfinding involved.
 */
class FakeVehicles extends EventEmitter implements JobVehicleGateway {
  routeCalls: { vehicleId: string; waypoints: Waypoint[] }[] = [];
  /** Vehicle ids that should fail to route. */
  unroutable = new Set<string>();
  /** vehicleId → ETA seconds returned by the probe. */
  etas = new Map<string, number>();

  constructor(private roster: VehicleDTO[]) {
    super();
  }

  getVehicles(): VehicleDTO[] {
    return this.roster;
  }

  async findAndSetWaypointRoutes(
    vehicleId: string,
    waypoints: Waypoint[]
  ): Promise<DirectionResult> {
    this.routeCalls.push({ vehicleId, waypoints });
    if (this.unroutable.has(vehicleId)) {
      return { vehicleId, status: "error", error: "No route found for leg 0" };
    }
    return {
      vehicleId,
      status: "ok",
      route: { start: [0, 0], end: [1, 1], distance: 12 },
      legs: [
        { start: [0, 0], end: [0.5, 0.5], distance: 4 },
        { start: [0.5, 0.5], end: [1, 1], distance: 8 },
      ],
    };
  }

  async estimateTo(vehicleId: string): Promise<{ etaSeconds: number; distanceKm: number } | null> {
    const etaSeconds = this.etas.get(vehicleId);
    if (etaSeconds === undefined) return null;
    return { etaSeconds, distanceKm: etaSeconds / 60 };
  }

  arriveAtPickup(vehicleId: string): void {
    this.emit("waypoint:reached", { vehicleId, waypointIndex: 0, remaining: 1 });
  }

  finishRoute(vehicleId: string): void {
    this.emit("route:completed", { vehicleId });
  }
}

function vehicle(id: string, lat: number, lng: number): VehicleDTO {
  return { id, name: `Unit ${id}`, type: "car", position: [lat, lng], speed: 0, heading: 0 };
}

const PICKUP = { lat: 0.1, lng: 0.1 };
const DROPOFF = { lat: 0.4, lng: 0.4 };

const OPTIONS = { slaSeconds: 600, pickupDwellSeconds: 30 };

describe("JobManager", () => {
  let vehicles: FakeVehicles;
  let manager: JobManager;
  let updates: JobDTO[];

  function setup(roster: VehicleDTO[]): void {
    vehicles = new FakeVehicles(roster);
    manager = new JobManager(vehicles, OPTIONS);
    updates = [];
    manager.on("job:updated", (job: JobDTO) => updates.push(job));
  }

  beforeEach(() => {
    setup([vehicle("far", 5, 5), vehicle("near", 0.11, 0.11)]);
  });

  afterEach(() => {
    manager.dispose();
    vi.useRealTimers();
  });

  describe("assignment", () => {
    it("assigns the closest vehicle under the nearest strategy and starts driving", async () => {
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      expect(job.status).toBe("en_route");
      expect(job.vehicleId).toBe("near");
      expect(job.strategy).toBe("nearest");
      expect(vehicles.routeCalls).toHaveLength(1);
      expect(vehicles.routeCalls[0].vehicleId).toBe("near");
    });

    it("routes the vehicle through the pickup then the dropoff", async () => {
      await manager.createJob({
        pickup: { ...PICKUP, label: "Depot" },
        dropoff: { ...DROPOFF, label: "Ward B" },
      });

      const { waypoints } = vehicles.routeCalls[0];
      expect(waypoints).toHaveLength(2);
      expect(waypoints[0].position).toEqual([PICKUP.lat, PICKUP.lng]);
      expect(waypoints[0].dwellTime).toBe(OPTIONS.pickupDwellSeconds);
      expect(waypoints[1].position).toEqual([DROPOFF.lat, DROPOFF.lng]);
      expect(waypoints[1].dwellTime).toBe(0);
    });

    it("derives per-leg ETAs and route distance from the routing result", async () => {
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      // car profile cruises at (20 + 60) / 2 = 40 km/h.
      expect(job.routeDistanceKm).toBe(12);
      expect(job.etaToPickupSeconds).toBe(Math.round((4 / 40) * 3600));
      expect(job.etaToDropoffSeconds).toBe(Math.round((12 / 40) * 3600));
    });

    it("prefers the lowest probed driving ETA over raw proximity under best_eta", async () => {
      vehicles.etas.set("near", 900);
      vehicles.etas.set("far", 120);

      const job = await manager.createJob({
        pickup: PICKUP,
        dropoff: DROPOFF,
        strategy: "best_eta",
      });

      expect(job.vehicleId).toBe("far");
    });

    it("falls back to the closest candidate when no probe can be routed", async () => {
      const job = await manager.createJob({
        pickup: PICKUP,
        dropoff: DROPOFF,
        strategy: "best_eta",
      });

      expect(job.vehicleId).toBe("near");
    });

    it("uses the named vehicle and marks the job manual when vehicleId is given", async () => {
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF, vehicleId: "far" });

      expect(job.strategy).toBe("manual");
      expect(job.vehicleId).toBe("far");
    });

    it("never assigns a vehicle that already holds a job", async () => {
      const first = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      const second = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      expect(first.vehicleId).toBe("near");
      expect(second.vehicleId).toBe("far");
    });

    it("skips vehicles still at the unplaced [0, 0] sentinel", async () => {
      setup([vehicle("unplaced", 0, 0)]);

      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      expect(job.status).toBe("pending");
      expect(job.vehicleId).toBeUndefined();
      expect(vehicles.routeCalls).toHaveLength(0);
    });

    it("queues the job as pending when the whole fleet is busy", async () => {
      setup([vehicle("only", 0.11, 0.11)]);
      await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      const queued = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      expect(queued.status).toBe("pending");
      expect(queued.error).toBe("Waiting for an available vehicle");
    });

    it("re-queues onto a different vehicle when routing fails", async () => {
      vehicles.unroutable.add("near");

      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      expect(job.status).toBe("pending");

      await manager.sweep();

      expect(manager.getJob(job.id)?.status).toBe("en_route");
      expect(manager.getJob(job.id)?.vehicleId).toBe("far");
    });

    it("fails the job once every candidate has been tried without a route", async () => {
      vehicles.unroutable.add("near");
      vehicles.unroutable.add("far");

      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      await manager.sweep(); // tries the second (and last) candidate
      expect(manager.getJob(job.id)?.status).toBe("pending");

      await manager.sweep(); // no candidates left

      expect(manager.getJob(job.id)?.status).toBe("failed");
      expect(manager.getJob(job.id)?.error).toBe("No vehicle could reach this pickup");
    });

    it("assigns a queued job as soon as a vehicle frees up", async () => {
      setup([vehicle("only", 0.11, 0.11)]);
      const first = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      const queued = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      expect(queued.status).toBe("pending");

      manager.cancelJob(first.id);
      await manager.sweep();

      expect(manager.getJob(queued.id)?.status).toBe("en_route");
      expect(manager.getJob(queued.id)?.vehicleId).toBe("only");
    });
  });

  describe("lifecycle", () => {
    it("advances en_route → on_scene → transporting → complete off vehicle events", async () => {
      vi.useFakeTimers();
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      expect(job.status).toBe("en_route");

      vehicles.arriveAtPickup("near");
      expect(manager.getJob(job.id)?.status).toBe("on_scene");
      expect(manager.getJob(job.id)?.pickedUpAt).toBeGreaterThan(0);

      vi.advanceTimersByTime(OPTIONS.pickupDwellSeconds * 1000);
      expect(manager.getJob(job.id)?.status).toBe("transporting");

      vehicles.finishRoute("near");
      const done = manager.getJob(job.id);
      expect(done?.status).toBe("complete");
      expect(done?.completedAt).toBeGreaterThan(0);
      expect(done?.slaBreached).toBe(false);
    });

    it("emits one job:updated per transition", async () => {
      vi.useFakeTimers();
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      vehicles.arriveAtPickup("near");
      vi.advanceTimersByTime(OPTIONS.pickupDwellSeconds * 1000);
      vehicles.finishRoute("near");

      expect(updates.filter((u) => u.id === job.id).map((u) => u.status)).toEqual([
        "assigned",
        "en_route",
        "on_scene",
        "transporting",
        "complete",
      ]);
    });

    it("frees the vehicle for new work once the job completes", async () => {
      vi.useFakeTimers();
      const first = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      vehicles.arriveAtPickup("near");
      vi.advanceTimersByTime(OPTIONS.pickupDwellSeconds * 1000);
      vehicles.finishRoute("near");
      vi.useRealTimers();

      const second = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      expect(second.vehicleId).toBe("near");
      // The finished job keeps its vehicle on the record for the audit trail.
      expect(manager.getJob(first.id)?.vehicleId).toBe("near");
    });

    it("ignores routing events from vehicles that hold no job", async () => {
      await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      const before = updates.length;

      vehicles.arriveAtPickup("far");
      vehicles.finishRoute("far");

      expect(updates).toHaveLength(before);
    });

    it("re-queues a job whose vehicle was re-dispatched before the pickup", async () => {
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      // route:completed with the pickup never reported means something replaced
      // this vehicle's route (a manual dispatch, a scenario).
      vehicles.finishRoute("near");

      const requeued = manager.getJob(job.id);
      expect(requeued?.status).toBe("pending");
      expect(requeued?.vehicleId).toBeUndefined();
      expect(requeued?.error).toBe("Vehicle was re-dispatched before pickup; job re-queued");
    });
  });

  describe("SLA tracking", () => {
    it("flags a breach and emits job:sla-breach once the deadline passes", async () => {
      const breaches: JobDTO[] = [];
      manager.on("job:sla-breach", (job: JobDTO) => breaches.push(job));

      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF, slaSeconds: 1 });
      expect(job.slaDeadline).toBe(job.createdAt + 1000);

      vi.setSystemTime(Date.now() + 2000);
      await manager.sweep();

      expect(breaches.map((b) => b.id)).toEqual([job.id]);
      expect(manager.getJob(job.id)?.slaBreached).toBe(true);

      // Latching: a second sweep must not re-fire the same breach.
      await manager.sweep();
      expect(breaches).toHaveLength(1);
      vi.useRealTimers();
    });

    it("marks a job that finishes past its deadline as breached on completion", async () => {
      vi.useFakeTimers();
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF, slaSeconds: 1 });
      vehicles.arriveAtPickup("near");
      vi.advanceTimersByTime(OPTIONS.pickupDwellSeconds * 1000);
      vehicles.finishRoute("near");

      const done = manager.getJob(job.id);
      expect(done?.status).toBe("complete");
      expect(done?.slaBreached).toBe(true);
    });

    it("leaves terminal jobs out of the breach sweep", async () => {
      const breaches: JobDTO[] = [];
      manager.on("job:sla-breach", (job: JobDTO) => breaches.push(job));
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF, slaSeconds: 1 });
      manager.cancelJob(job.id);

      vi.setSystemTime(Date.now() + 5000);
      await manager.sweep();

      expect(breaches).toHaveLength(0);
      vi.useRealTimers();
    });
  });

  describe("operator actions", () => {
    it("re-assigns a not-yet-collected job to a named vehicle", async () => {
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      expect(job.vehicleId).toBe("near");

      const moved = await manager.reassignJob(job.id, { vehicleId: "far" });

      expect(moved.vehicleId).toBe("far");
      expect(moved.strategy).toBe("manual");
      expect(moved.status).toBe("en_route");
    });

    it("refuses to re-assign a job already picked up", async () => {
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      vehicles.arriveAtPickup("near");

      await expect(manager.reassignJob(job.id, { vehicleId: "far" })).rejects.toThrow(
        /already been picked up/
      );
    });

    it("cancels a live job and releases its vehicle", async () => {
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      const cancelled = manager.cancelJob(job.id);

      expect(cancelled.status).toBe("cancelled");
      const replacement = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      expect(replacement.vehicleId).toBe("near");
    });

    it("refuses to cancel an already-terminal job", async () => {
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      manager.cancelJob(job.id);

      expect(() => manager.cancelJob(job.id)).toThrow(/already cancelled/);
    });

    it("deletes a terminal job and emits job:deleted", async () => {
      const deleted: { id: string }[] = [];
      manager.on("job:deleted", (payload: { id: string }) => deleted.push(payload));
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      manager.cancelJob(job.id);

      manager.deleteJob(job.id);

      expect(deleted).toEqual([{ id: job.id }]);
      expect(manager.getJob(job.id)).toBeUndefined();
    });

    it("refuses to delete a live job", async () => {
      const job = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      expect(() => manager.deleteJob(job.id)).toThrow(/cancel it first/);
    });

    it("drops every job and frees every vehicle on reset", async () => {
      await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

      manager.reset();

      expect(manager.getJobs()).toEqual([]);
      const fresh = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
      expect(fresh.vehicleId).toBe("near");
    });
  });

  it("gives every job a distinct operator-facing reference", async () => {
    const a = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });
    const b = await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

    expect(a.reference).toMatch(/^JOB-[0-9A-F]{4}$/);
    expect(b.reference).not.toBe(a.reference);
  });

  it("emits job:created before any assignment result", async () => {
    const order: string[] = [];
    manager.on("job:created", (job: JobDTO) => order.push(`created:${job.status}`));
    manager.on("job:updated", (job: JobDTO) => order.push(`updated:${job.status}`));

    await manager.createJob({ pickup: PICKUP, dropoff: DROPOFF });

    expect(order[0]).toBe("created:pending");
    expect(order).toContain("updated:en_route");
  });
});
