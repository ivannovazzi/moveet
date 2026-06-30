import type { DataVehicle, Vehicle, VehicleType } from "../types";
import { config } from "../utils/config";
import Adapter from "./Adapter";
import { recordAdapterSync } from "../metrics";
import logger from "../utils/logger";

/** Maximum backoff delay between sync attempts after consecutive failures (ms). */
const MAX_SYNC_BACKOFF_MS = 60_000;

/** Consecutive-failure count at which a persistent-failure error is logged. */
const PERSISTENT_FAILURE_THRESHOLD = 5;

/**
 * Manages adapter integration: fetching vehicles from external adapter
 * and syncing vehicle locations back to the adapter.
 */
export class AdapterSyncManager {
  private adapter = new Adapter();
  private syncTimer: NodeJS.Timeout | null = null;
  private syncSession = 0;
  private inFlightSync: Promise<void> | null = null;

  /**
   * Fetches vehicles from the adapter and invokes the callback for each.
   * Must be called after construction when ADAPTER_URL is configured.
   */
  async initFromAdapter(
    addVehicle: (
      id: string,
      name: string,
      position?: [number, number],
      type?: VehicleType,
      metadata?: Record<string, unknown>
    ) => void,
    loadFallback: () => void,
    limit?: number
  ): Promise<void> {
    if (!config.adapterURL) return;

    try {
      const adapterVehicles = await this.adapter.get();
      if (adapterVehicles.length === 0) {
        logger.warn("Adapter returned no vehicles, falling back to default data");
        loadFallback();
        return;
      }
      // Cap to the requested count when a positive limit is given (e.g. the
      // headless generator subsetting the fleet); otherwise take the whole fleet.
      const selected =
        limit !== undefined && limit > 0 ? adapterVehicles.slice(0, limit) : adapterVehicles;
      selected.forEach((v) => {
        addVehicle(v.id, v.name, v.position, v.type, v.metadata);
      });
      logger.info(`Loaded ${selected.length} of ${adapterVehicles.length} vehicles from adapter`);
    } catch (error) {
      logger.error(`Failed to load vehicles from adapter: ${error}`);
      logger.warn("Falling back to default vehicle data");
      loadFallback();
    }
  }

  /**
   * Fetches vehicle definitions from the adapter (async) or returns null
   * to indicate that default data should be used.
   */
  async fetchAdapterVehicles(): Promise<DataVehicle[] | null> {
    if (!config.adapterURL) return null;

    try {
      const adapterVehicles = await this.adapter.get();
      if (adapterVehicles.length === 0) {
        logger.warn("Adapter returned no vehicles, falling back to default data");
        return null;
      }
      logger.info(`Loaded ${adapterVehicles.length} vehicles from adapter`);
      return adapterVehicles;
    } catch (error) {
      logger.error(`Failed to load vehicles from adapter: ${error}`);
      logger.warn("Falling back to default vehicle data");
      return null;
    }
  }

  /**
   * Starts periodic synchronization of vehicle locations to external adapter.
   *
   * Implemented as a self-scheduling timeout chain so that consecutive sync
   * failures back off exponentially (with jitter, capped at MAX_SYNC_BACKOFF_MS)
   * instead of hammering an unhealthy adapter at the fixed cadence. The delay
   * resets to `intervalMs` on the first successful sync.
   */
  startLocationUpdates(intervalMs: number, getVehicles: () => IterableIterator<Vehicle>): void {
    this.stopLocationUpdates();
    const session = this.syncSession;
    // Consecutive-failure counter scoped to this session so a stale sync
    // settling after a restart can't corrupt the new session's backoff state
    // (or log a spurious recovery for it).
    let failures = 0;

    const syncOnce = async (): Promise<void> => {
      const vehicles = Array.from(getVehicles());
      // The periodic sync runs outside any HTTP request, so generate a fresh
      // correlation id per push cycle and forward it as x-request-id so the
      // adapter can thread it into its telemetry envelope.
      const correlationId = crypto.randomUUID();
      const start = process.hrtime.bigint();
      try {
        await this.adapter.sync(
          {
            vehicles: vehicles.map((v) => ({
              id: v.id,
              name: v.name,
              type: v.type,
              latitude: v.position[0],
              longitude: v.position[1],
              speed: v.speed, // km/h
              heading: v.bearing, // degrees
              // Carry source-provided metadata opaquely back to the adapter/sinks.
              ...(v.sourceMetadata !== undefined ? { metadata: v.sourceMetadata } : {}),
            })),
            timestamp: Date.now(),
          },
          correlationId
        );
        recordAdapterSync("success", Number(process.hrtime.bigint() - start) / 1e9);
      } catch (error) {
        recordAdapterSync("failure", Number(process.hrtime.bigint() - start) / 1e9);
        throw error;
      }
    };

    const scheduleNext = (delayMs: number): void => {
      if (session !== this.syncSession) return; // stopped or restarted meanwhile
      this.syncTimer = setTimeout(async () => {
        const sync = syncOnce();
        const tracked = sync.then(
          () => undefined,
          () => undefined
        );
        this.inFlightSync = tracked;
        try {
          await sync;
          if (failures > 0) {
            logger.info(`Adapter sync recovered after ${failures} consecutive failure(s)`);
          }
          failures = 0;
          scheduleNext(intervalMs);
        } catch (error) {
          failures++;
          logger.error(`Failed to sync vehicles to adapter: ${error}`);
          // Cap the exponential backoff at MAX_SYNC_BACKOFF_MS. Using min() (not
          // max()) is essential: with max(), an intervalMs above the cap would
          // make the cap == intervalMs and silently defeat the 60s ceiling.
          const backoff = Math.min(intervalMs * 2 ** failures, MAX_SYNC_BACKOFF_MS);
          const jitter = Math.floor(Math.random() * backoff * 0.1);
          if (failures === PERSISTENT_FAILURE_THRESHOLD) {
            logger.error(
              `Adapter sync failing persistently (${failures} consecutive failures); backing off up to ${MAX_SYNC_BACKOFF_MS}ms between attempts`
            );
          }
          scheduleNext(backoff + jitter);
        } finally {
          // Identity guard: a stale session's sync settling after a restart
          // must not null out the NEW session's tracked promise, or a
          // shutdown drain() in that window would miss the in-flight push.
          if (this.inFlightSync === tracked) {
            this.inFlightSync = null;
          }
        }
      }, delayMs);
    };

    scheduleNext(intervalMs);
  }

  /**
   * Stops periodic synchronization of vehicle locations to external adapter.
   */
  stopLocationUpdates(): void {
    this.syncSession++;
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Waits (bounded) for an in-flight sync request to settle.
   * Used during graceful shutdown so the final position push isn't dropped.
   */
  async drain(timeoutMs: number): Promise<void> {
    if (!this.inFlightSync) return;
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.inFlightSync,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
        }),
      ]);
    } finally {
      // Don't let the race timer keep the event loop alive after a fast settle.
      clearTimeout(timer);
    }
  }
}
