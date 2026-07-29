import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import type {
  CreateJobRequest,
  DirectionResult,
  JobAssignmentStrategy,
  JobDTO,
  JobStatus,
  Position,
  RouteCompletedPayload,
  VehicleDTO,
  Waypoint,
  WaypointReachedPayload,
} from "@moveet/shared-types";
import { TERMINAL_JOB_STATUSES } from "@moveet/shared-types";
import { calculateDistance } from "../utils/helpers";
import { getProfile } from "../utils/vehicleProfiles";
import { config } from "../utils/config";
import logger from "../utils/logger";

/**
 * The slice of `VehicleManager` this module needs. Declared structurally so
 * tests can drive the whole lifecycle with a plain EventEmitter instead of a
 * road network — assignment and status transitions are the logic worth testing,
 * and neither depends on real pathfinding.
 */
export interface JobVehicleGateway {
  getVehicles(): VehicleDTO[];
  findAndSetWaypointRoutes(vehicleId: string, waypoints: Waypoint[]): Promise<DirectionResult>;
  estimateTo(
    vehicleId: string,
    destination: Position
  ): Promise<{ etaSeconds: number; distanceKm: number } | null>;
  on(event: "waypoint:reached", listener: (payload: WaypointReachedPayload) => void): unknown;
  on(event: "route:completed", listener: (payload: RouteCompletedPayload) => void): unknown;
}

/**
 * How many of the closest candidates `best_eta` actually pathfinds against.
 *
 * Each probe is a full A* call, so scoring every idle vehicle in a 1000-unit
 * fleet would put seconds of pathfinding in front of a single POST. The nearest
 * few contain the winner in all but pathological network shapes, and the
 * fallback (`nearest`) is what the probe would degrade to anyway.
 */
const MAX_ETA_PROBES = 5;

/**
 * Give up on a job after this many distinct vehicles fail to produce a route to
 * it. Without a cap a pickup in an unroutable pocket would re-queue forever,
 * burning an A* call per vehicle per sweep.
 */
const MAX_ASSIGN_ATTEMPTS = 3;

/** Cadence of the SLA / pending-queue sweep. */
const SWEEP_INTERVAL_MS = 1000;

const TERMINAL = new Set<JobStatus>(TERMINAL_JOB_STATUSES);

/** Per-job bookkeeping that never goes on the wire. */
interface JobRuntime {
  /** Vehicles already tried and rejected (no route). Bounds re-assignment. */
  attempted: Set<string>;
  /** Vehicle the operator named, for `manual` jobs. */
  manualVehicleId?: string;
  /** Pending on-scene → transporting transition. */
  dwellTimer?: NodeJS.Timeout;
}

function referenceFromId(id: string): string {
  return `JOB-${id.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

/**
 * The trip/job dispatch lifecycle.
 *
 * A job is a pickup and a dropoff. `JobManager` chooses a vehicle for it, sends
 * that vehicle through both stops as a two-waypoint route, and advances the
 * job's status off the vehicle's own routing events — so the job board and the
 * map are always describing the same physical movement rather than two
 * independent state machines.
 *
 * Emits: `job:created`, `job:updated` (every transition), `job:sla-breach`,
 * `job:deleted`. Wired to the WS broadcaster in `setup/eventWiring.ts`.
 */
export class JobManager extends EventEmitter {
  private jobs = new Map<string, JobDTO>();
  private runtime = new Map<string, JobRuntime>();
  /** vehicleId → jobId. The single source of truth for "this unit is busy". */
  private busyVehicles = new Map<string, string>();
  /** Jobs with an in-flight assignment, so the sweep can't double-assign. */
  private assigning = new Set<string>();
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private vehicles: JobVehicleGateway,
    private options: { slaSeconds: number; pickupDwellSeconds: number } = {
      slaSeconds: config.jobSlaSeconds,
      pickupDwellSeconds: config.jobPickupDwellSeconds,
    }
  ) {
    super();
    this.vehicles.on("waypoint:reached", (payload) => this.onWaypointReached(payload));
    this.vehicles.on("route:completed", (payload) => this.onRouteCompleted(payload));
  }

  // ─── Public API ───────────────────────────────────────────────────

  getJobs(): JobDTO[] {
    return Array.from(this.jobs.values());
  }

  getJob(id: string): JobDTO | undefined {
    return this.jobs.get(id);
  }

  /**
   * Creates a job and immediately attempts to assign it.
   *
   * `job:created` is emitted before the assignment attempt so the job board
   * shows the queued row instantly; the assignment result arrives as a
   * `job:updated`. The returned DTO is post-assignment, so a REST caller sees
   * the assigned vehicle in the 201 body.
   */
  async createJob(request: CreateJobRequest): Promise<JobDTO> {
    const id = randomUUID();
    const createdAt = Date.now();
    const slaSeconds = request.slaSeconds ?? this.options.slaSeconds;
    const strategy: JobAssignmentStrategy = request.vehicleId
      ? "manual"
      : (request.strategy ?? "nearest");

    const job: JobDTO = {
      id,
      reference: referenceFromId(id),
      status: "pending",
      pickup: {
        position: [request.pickup.lat, request.pickup.lng],
        label: request.pickup.label,
      },
      dropoff: {
        position: [request.dropoff.lat, request.dropoff.lng],
        label: request.dropoff.label,
      },
      strategy,
      createdAt,
      slaSeconds,
      slaDeadline: createdAt + slaSeconds * 1000,
      slaBreached: false,
    };

    this.jobs.set(id, job);
    this.runtime.set(id, { attempted: new Set(), manualVehicleId: request.vehicleId });
    this.emit("job:created", { ...job });
    this.ensureSweep();

    await this.tryAssign(id);
    return { ...(this.jobs.get(id) as JobDTO) };
  }

  /**
   * Re-targets a job at a specific vehicle (or re-runs the search with a new
   * strategy). Only valid while the job hasn't been picked up — after that the
   * load is already on board and swapping units would be a different job.
   */
  async reassignJob(
    id: string,
    opts: { vehicleId?: string; strategy?: JobAssignmentStrategy }
  ): Promise<JobDTO> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (job.status === "on_scene" || job.status === "transporting") {
      throw new Error(`Job ${job.reference} has already been picked up`);
    }
    if (TERMINAL.has(job.status)) {
      throw new Error(`Job ${job.reference} is ${job.status}`);
    }

    const state = this.requireRuntime(id);
    this.clearDwell(state);
    this.releaseVehicle(job);

    state.manualVehicleId = opts.vehicleId;
    // A fresh operator decision supersedes the previous no-route history.
    state.attempted.clear();
    job.strategy = opts.vehicleId ? "manual" : (opts.strategy ?? job.strategy);
    job.status = "pending";
    job.error = undefined;
    job.etaToPickupSeconds = undefined;
    job.etaToDropoffSeconds = undefined;
    job.routeDistanceKm = undefined;
    job.assignedAt = undefined;
    this.publish(job);

    this.ensureSweep();
    await this.tryAssign(id);
    return { ...(this.jobs.get(id) as JobDTO) };
  }

  /**
   * Cancels a job and frees its vehicle. The vehicle keeps driving its current
   * route (there is nothing to un-drive), but is immediately eligible for new
   * work — the next assignment simply replaces its route.
   */
  cancelJob(id: string): JobDTO {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (TERMINAL.has(job.status)) throw new Error(`Job ${job.reference} is already ${job.status}`);

    const state = this.runtime.get(id);
    if (state) this.clearDwell(state);
    // Status first: a terminal job keeps its vehicle on the record (who was
    // carrying it when it was pulled) while still freeing the unit for new work.
    job.status = "cancelled";
    this.releaseVehicle(job);
    this.publish(job);
    this.maybeStopSweep();
    return { ...job };
  }

  /** Removes a finished job from the board. Live jobs must be cancelled first. */
  deleteJob(id: string): void {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (!TERMINAL.has(job.status)) {
      throw new Error(`Job ${job.reference} is still ${job.status}; cancel it first`);
    }
    const state = this.runtime.get(id);
    if (state) this.clearDwell(state);
    this.jobs.delete(id);
    this.runtime.delete(id);
    this.emit("job:deleted", { id });
  }

  /**
   * Drops all job state. Called on simulation reset, where the vehicle roster
   * itself is rebuilt and every assignment is therefore stale.
   */
  reset(): void {
    for (const state of this.runtime.values()) this.clearDwell(state);
    this.jobs.clear();
    this.runtime.clear();
    this.busyVehicles.clear();
    this.assigning.clear();
    this.stopSweep();
  }

  /** Releases the sweep timer. Safe to call when already stopped. */
  dispose(): void {
    this.stopSweep();
    for (const state of this.runtime.values()) this.clearDwell(state);
  }

  // ─── Assignment ───────────────────────────────────────────────────

  private async tryAssign(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (job?.status !== "pending") return;
    if (this.assigning.has(id)) return;
    this.assigning.add(id);

    try {
      const state = this.requireRuntime(id);
      const { vehicle, rosterSize } = await this.pickVehicle(job, state);

      if (!vehicle) {
        // A small fleet exhausts its candidates before MAX_ASSIGN_ATTEMPTS, so
        // the give-up point is whichever comes first — otherwise a two-vehicle
        // fleet that both fail to route would retry the same pair forever.
        const attemptCap = Math.min(MAX_ASSIGN_ATTEMPTS, Math.max(1, rosterSize));
        if (state.attempted.size >= attemptCap) {
          job.status = "failed";
          job.error = "No vehicle could reach this pickup";
          this.publish(job);
          this.maybeStopSweep();
          return;
        }
        // Nothing free yet. Say so once — the sweep retries every second and
        // re-emitting the same message each time is pure noise.
        const message = "Waiting for an available vehicle";
        if (job.error !== message) {
          job.error = message;
          this.publish(job);
        }
        return;
      }

      this.busyVehicles.set(vehicle.id, job.id);
      state.attempted.add(vehicle.id);
      job.vehicleId = vehicle.id;
      job.vehicleName = vehicle.name;
      job.status = "assigned";
      job.assignedAt = Date.now();
      job.error = undefined;
      this.publish(job);

      const result = await this.vehicles.findAndSetWaypointRoutes(vehicle.id, [
        {
          position: job.pickup.position,
          label: `${job.reference} pickup`,
          dwellTime: this.options.pickupDwellSeconds,
        },
        { position: job.dropoff.position, label: `${job.reference} dropoff`, dwellTime: 0 },
      ]);

      if (result.status !== "ok") {
        // Vehicle-specific failure: put the job back in the queue so the sweep
        // can try a different unit (bounded by MAX_ASSIGN_ATTEMPTS).
        this.releaseVehicle(job);
        job.status = "pending";
        job.assignedAt = undefined;
        job.error = result.error ?? "Routing failed";
        this.publish(job);
        return;
      }

      const legs = result.legs ?? [];
      const toPickupKm = legs[0]?.distance ?? 0;
      const totalKm = result.route?.distance ?? toPickupKm;
      job.etaToPickupSeconds = etaSeconds(toPickupKm, vehicle);
      job.etaToDropoffSeconds = etaSeconds(totalKm, vehicle);
      job.routeDistanceKm = totalKm;
      job.status = "en_route";
      job.error = undefined;
      this.publish(job);
    } catch (err) {
      logger.error(`Job assignment failed for ${id}: ${err}`);
    } finally {
      this.assigning.delete(id);
    }
  }

  /**
   * Picks a vehicle for `job`, or reports that none is currently eligible.
   *
   * `rosterSize` comes back alongside the choice because the caller needs it to
   * decide whether "no candidate" means "wait" or "give up", and re-reading the
   * roster would re-serialize every vehicle in the fleet.
   */
  private async pickVehicle(
    job: JobDTO,
    state: JobRuntime
  ): Promise<{ vehicle: VehicleDTO | null; rosterSize: number }> {
    const roster = this.vehicles.getVehicles();
    const available = roster.filter((v) => {
      if (this.busyVehicles.has(v.id)) return false;
      if (state.attempted.has(v.id)) return false;
      // [0, 0] is the simulator's "not placed on the network yet" sentinel.
      return v.position[0] !== 0 || v.position[1] !== 0;
    });
    const rosterSize = roster.length;

    if (job.strategy === "manual") {
      const wanted = state.manualVehicleId;
      return { vehicle: available.find((v) => v.id === wanted) ?? null, rosterSize };
    }

    if (available.length === 0) return { vehicle: null, rosterSize };

    const byProximity = available
      .map((v) => ({ vehicle: v, km: calculateDistance(v.position, job.pickup.position) }))
      .sort((a, b) => a.km - b.km);

    if (job.strategy === "nearest") return { vehicle: byProximity[0].vehicle, rosterSize };

    // best_eta: pathfind from the closest few and take the lowest driving time,
    // so a closer unit stuck behind a closure loses to a farther one on open road.
    const probes = byProximity.slice(0, MAX_ETA_PROBES);
    const scored = await Promise.all(
      probes.map(async ({ vehicle }) => ({
        vehicle,
        estimate: await this.vehicles.estimateTo(vehicle.id, job.pickup.position),
      }))
    );
    const routable = scored.filter(
      (s): s is { vehicle: VehicleDTO; estimate: { etaSeconds: number; distanceKm: number } } =>
        s.estimate !== null
    );
    if (routable.length === 0) return { vehicle: probes[0].vehicle, rosterSize };
    routable.sort((a, b) => a.estimate.etaSeconds - b.estimate.etaSeconds);
    return { vehicle: routable[0].vehicle, rosterSize };
  }

  // ─── Lifecycle driven by the vehicle's own routing events ─────────

  private onWaypointReached(payload: WaypointReachedPayload): void {
    const job = this.jobForVehicle(payload.vehicleId);
    if (job?.status !== "en_route") return;
    // Waypoint 0 is the pickup; the dropoff arrives as `route:completed`.
    if (payload.waypointIndex !== 0) return;

    job.status = "on_scene";
    job.pickedUpAt = Date.now();
    this.publish(job);

    // RouteManager holds the vehicle at the pickup for exactly the dwellTime we
    // passed at assignment, and emits nothing when it releases it — so mirror
    // that same duration here rather than inventing a second timing source.
    const state = this.requireRuntime(job.id);
    this.clearDwell(state);
    const timer = setTimeout(() => {
      const current = this.jobs.get(job.id);
      if (current?.status !== "on_scene") return;
      current.status = "transporting";
      this.publish(current);
    }, this.options.pickupDwellSeconds * 1000);
    timer.unref?.();
    state.dwellTimer = timer;
  }

  private onRouteCompleted(payload: RouteCompletedPayload): void {
    const job = this.jobForVehicle(payload.vehicleId);
    if (!job) return;

    const state = this.runtime.get(job.id);
    if (state) this.clearDwell(state);

    if (job.status === "transporting" || job.status === "on_scene") {
      job.status = "complete";
      job.completedAt = Date.now();
      this.releaseVehicle(job);
      if (!job.slaBreached && job.completedAt > job.slaDeadline) {
        job.slaBreached = true;
        this.emit("job:sla-breach", { ...job });
      }
      this.publish(job);
      this.maybeStopSweep();
      return;
    }

    // The route finished without the pickup waypoint ever being reported, which
    // means something else (a manual dispatch, a scenario) replaced this
    // vehicle's route. The load was never collected, so re-queue the job.
    this.releaseVehicle(job);
    job.status = "pending";
    job.assignedAt = undefined;
    job.error = "Vehicle was re-dispatched before pickup; job re-queued";
    this.publish(job);
    this.ensureSweep();
  }

  // ─── SLA + pending-queue sweep ────────────────────────────────────

  private ensureSweep(): void {
    if (this.sweepTimer) return;
    const timer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    // Unref'd so an unfinished job can never hold the process open at shutdown.
    timer.unref?.();
    this.sweepTimer = timer;
  }

  private stopSweep(): void {
    if (!this.sweepTimer) return;
    clearInterval(this.sweepTimer);
    this.sweepTimer = null;
  }

  private maybeStopSweep(): void {
    for (const job of this.jobs.values()) {
      if (!TERMINAL.has(job.status)) return;
    }
    this.stopSweep();
  }

  /**
   * Sweep body: flag SLA breaches, then retry the pending queue.
   *
   * Awaitable so callers (and tests) can observe the assignment attempts it
   * kicks off; the interval itself discards the promise.
   */
  async sweep(): Promise<void> {
    const now = Date.now();
    const assignments: Promise<void>[] = [];
    for (const job of this.jobs.values()) {
      if (TERMINAL.has(job.status)) continue;
      if (!job.slaBreached && now > job.slaDeadline) {
        job.slaBreached = true;
        this.emit("job:sla-breach", { ...job });
        this.publish(job);
      }
      if (job.status === "pending") assignments.push(this.tryAssign(job.id));
    }
    await Promise.all(assignments);
    this.maybeStopSweep();
  }

  // ─── Internals ────────────────────────────────────────────────────

  private jobForVehicle(vehicleId: string): JobDTO | undefined {
    const jobId = this.busyVehicles.get(vehicleId);
    return jobId ? this.jobs.get(jobId) : undefined;
  }

  private requireRuntime(id: string): JobRuntime {
    let state = this.runtime.get(id);
    if (!state) {
      state = { attempted: new Set() };
      this.runtime.set(id, state);
    }
    return state;
  }

  private releaseVehicle(job: JobDTO): void {
    if (job.vehicleId) this.busyVehicles.delete(job.vehicleId);
    if (!TERMINAL.has(job.status)) {
      // A terminal job keeps its vehicle on the record for the audit trail; a
      // re-queued one must not claim a unit it no longer holds.
      job.vehicleId = undefined;
      job.vehicleName = undefined;
    }
  }

  private clearDwell(state: JobRuntime): void {
    if (!state.dwellTimer) return;
    clearTimeout(state.dwellTimer);
    state.dwellTimer = undefined;
  }

  /** Emit a defensive copy so listeners can't mutate the live job. */
  private publish(job: JobDTO): void {
    this.emit("job:updated", { ...job });
  }
}

/**
 * Driving seconds for `km` at the vehicle profile's cruise speed.
 *
 * Deliberately not the vehicle's instantaneous speed: a dwelling or just-spawned
 * candidate reads 0 km/h, which would price every idle unit at an infinite ETA —
 * exactly backwards, since idle units are the ones worth dispatching.
 */
function etaSeconds(km: number, vehicle: VehicleDTO): number {
  const profile = getProfile(vehicle.type);
  const cruiseKmh = (profile.minSpeed + profile.maxSpeed) / 2;
  return Math.round((km / cruiseKmh) * 3600);
}
