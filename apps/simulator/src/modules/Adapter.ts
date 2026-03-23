import type { DataVehicle } from "../types";
import { config } from "../utils/config";
import logger from "../utils/logger";

interface SyncVehicle {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  type?: string;
}

interface SyncData {
  vehicles: SyncVehicle[];
  timestamp?: number;
}

const REQUEST_TIMEOUT_MS = config.syncAdapterTimeout || 10_000;

export default class Adapter {
  private async request<T>(path: string, options: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${config.adapterURL}${path}`, {
        ...options,
        keepalive: true,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Adapter request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        logger.error(`Adapter request to ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`);
        throw new Error(`Adapter request to ${path} timed out`, { cause: error });
      }
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error from adapter: ${errorMessage}`);
      throw new Error(`Adapter request to ${path} failed: ${errorMessage}`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fetches the list of vehicles from the external adapter service.
   * Used during initialization to load vehicle data from an external system.
   *
   * @returns Promise resolving to array of vehicle data with IDs, names, and positions
   * @throws {Error} If the adapter request fails or returns invalid data
   *
   * @example
   * const vehicles = await adapter.get();
   * console.log(`Loaded ${vehicles.length} vehicles from adapter`);
   */
  public async get(): Promise<DataVehicle[]> {
    return this.request<DataVehicle[]>("/vehicles", { method: "GET" });
  }

  /**
   * Synchronizes current vehicle locations to the external adapter service.
   * Sends vehicle positions and timestamp in a single batch update.
   *
   * @param data - Synchronization payload containing vehicles array and optional timestamp
   * @returns Promise that resolves when sync completes
   * @throws {Error} If the adapter request fails
   *
   * @example
   * await adapter.sync({
   *   vehicles: [
   *     { id: 'v1', name: 'Vehicle 1', latitude: 45.5, longitude: -73.5 }
   *   ],
   *   timestamp: Date.now()
   * });
   */
  public async sync(data: SyncData): Promise<void> {
    await this.request<void>("/sync", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
  }
}
