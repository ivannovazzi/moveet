import type { DataVehicle, Vehicle } from "../types";
import { config } from "../utils/config";
import Adapter from "./Adapter";
import logger from "../utils/logger";

/**
 * Manages adapter integration: fetching vehicles from external adapter
 * and syncing vehicle locations back to the adapter.
 */
export class AdapterSyncManager {
  private adapter = new Adapter();
  private locationInterval: NodeJS.Timeout | null = null;

  /**
   * Fetches vehicles from the adapter and invokes the callback for each.
   * Must be called after construction when ADAPTER_URL is configured.
   */
  async initFromAdapter(
    addVehicle: (id: string, name: string, position: [number, number]) => void,
    loadFallback: () => void
  ): Promise<void> {
    if (!config.adapterURL) return;

    try {
      const adapterVehicles = await this.adapter.get();
      if (adapterVehicles.length === 0) {
        logger.warn("Adapter returned no vehicles, falling back to default data");
        loadFallback();
        return;
      }
      adapterVehicles.forEach((v) => {
        addVehicle(v.id, v.name, v.position);
      });
      logger.info(`Loaded ${adapterVehicles.length} vehicles from adapter`);
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
   */
  startLocationUpdates(
    intervalMs: number,
    getVehicles: () => IterableIterator<Vehicle>
  ): void {
    if (this.locationInterval) {
      clearInterval(this.locationInterval);
    }
    this.locationInterval = setInterval(async () => {
      try {
        const vehicles = Array.from(getVehicles());
        await this.adapter.sync({
          vehicles: vehicles.map((v) => ({
            id: v.id,
            name: v.name,
            type: v.type,
            latitude: v.position[0],
            longitude: v.position[1],
          })),
          timestamp: Date.now(),
        });
      } catch (error) {
        logger.error(`Failed to sync vehicles to adapter: ${error}`);
      }
    }, intervalMs);
  }

  /**
   * Stops periodic synchronization of vehicle locations to external adapter.
   */
  stopLocationUpdates(): void {
    if (this.locationInterval) {
      clearInterval(this.locationInterval);
      this.locationInterval = null;
    }
  }
}
