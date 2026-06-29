import type { ClientDeps } from "./types";
import type { ConnectionStateListener } from "../wsClient";
import type {
  StartOptions,
  SimulationStatus,
  VehicleDTO,
  VehicleDirection as Direction,
  Heatzone,
} from "@/types";
import type { ResetPayload } from "../wsTypes";
import { isValidVehicleDTO } from "@moveet/shared-types";

/**
 * WebSocket lifecycle + core real-time channels (vehicle/status/options/
 * heatzones/direction/reset) and connection-state observation.
 */
export class ConnectionSegment {
  /** Set once we have logged a dropped invalid vehicle, to avoid console spam. */
  private warnedInvalidVehicle = false;

  constructor(private deps: ClientDeps) {
    this.connectWebSocket = this.connectWebSocket.bind(this);
    this.retryConnection = this.retryConnection.bind(this);
    this.disconnect = this.disconnect.bind(this);
    this.onConnect = this.onConnect.bind(this);
    this.offConnect = this.offConnect.bind(this);
    this.onDisconnect = this.onDisconnect.bind(this);
    this.offDisconnect = this.offDisconnect.bind(this);
    this.onConnectionStateChange = this.onConnectionStateChange.bind(this);
    this.onVehicle = this.onVehicle.bind(this);
    this.offVehicle = this.offVehicle.bind(this);
    this.onStatus = this.onStatus.bind(this);
    this.offStatus = this.offStatus.bind(this);
    this.onOptions = this.onOptions.bind(this);
    this.offOptions = this.offOptions.bind(this);
    this.onHeatzones = this.onHeatzones.bind(this);
    this.offHeatzones = this.offHeatzones.bind(this);
    this.onDirection = this.onDirection.bind(this);
    this.offDirection = this.offDirection.bind(this);
    this.onReset = this.onReset.bind(this);
    this.offReset = this.offReset.bind(this);
  }

  connectWebSocket(): void {
    this.deps.ws.connect();
  }

  /** Reset the reconnect attempt counter and try connecting again. */
  retryConnection(): void {
    this.deps.ws.retry();
  }

  disconnect(): void {
    this.deps.ws.disconnect();
  }

  onConnect(handler: () => void): void {
    this.deps.ws.on("connect", handler);
  }

  offConnect(handler?: () => void): void {
    this.deps.ws.off("connect", handler);
  }

  onDisconnect(handler: () => void): void {
    this.deps.ws.on("disconnect", handler);
  }

  offDisconnect(handler?: () => void): void {
    this.deps.ws.off("disconnect", handler);
  }

  onConnectionStateChange(listener: ConnectionStateListener): () => void {
    return this.deps.ws.onConnectionStateChange(listener);
  }

  onVehicle(handler: (vehicle: VehicleDTO) => void): void {
    // Guard the vehicle hot path: drop any vehicle with non-finite
    // position/speed/heading so NaN/Infinity never reaches the GL layer.
    // Log at most once per session to avoid console spam under a bad feed.
    const safeHandle = (v: VehicleDTO) => {
      if (isValidVehicleDTO(v)) {
        handler(v);
      } else if (!this.warnedInvalidVehicle) {
        this.warnedInvalidVehicle = true;
        console.warn("Dropping vehicle update with non-finite position/speed/heading:", v);
      }
    };
    this.deps.ws.on<VehicleDTO>("vehicle", safeHandle);
    this.deps.ws.on<VehicleDTO[]>("vehicles", (vehicles) => {
      for (const v of vehicles) safeHandle(v);
    });
  }

  offVehicle(): void {
    this.deps.ws.off("vehicle");
    this.deps.ws.off("vehicles");
  }

  onStatus(handler: (status: SimulationStatus) => void): void {
    this.deps.ws.on("status", handler);
  }

  offStatus(handler?: (status: SimulationStatus) => void): void {
    this.deps.ws.off("status", handler);
  }

  onOptions(handler: (opts: StartOptions) => void): void {
    this.deps.ws.on("options", handler);
  }

  offOptions(handler?: (opts: StartOptions) => void): void {
    this.deps.ws.off("options", handler);
  }

  onHeatzones(handler: (heatzones: Heatzone[]) => void): void {
    this.deps.ws.on("heatzones", handler);
  }

  offHeatzones(handler?: (heatzones: Heatzone[]) => void): void {
    this.deps.ws.off("heatzones", handler);
  }

  onDirection(handler: (direction: Direction) => void): void {
    this.deps.ws.on("direction", handler);
  }

  offDirection(handler?: (direction: Direction) => void): void {
    this.deps.ws.off("direction", handler);
  }

  onReset(handler: (data: ResetPayload) => void): void {
    this.deps.ws.on("reset", handler);
  }

  offReset(handler?: (data: ResetPayload) => void): void {
    this.deps.ws.off("reset", handler);
  }
}
