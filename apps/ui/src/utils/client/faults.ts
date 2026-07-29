import type { ClientDeps } from "./types";
import type { ApiResponse } from "@/types";
import type {
  DeviceFaultConfig,
  DeviceFaultProfile,
  DeviceFaultState,
  DeviceFaultStatus,
} from "@moveet/shared-types";

/** Patch body for `POST /faults`. Every field is optional; `default: null` clears it. */
export interface FaultConfigPatch {
  enabled?: boolean;
  seed?: number;
  default?: DeviceFaultProfile | null;
  vehicles?: Record<string, DeviceFaultProfile>;
}

/**
 * Device fault injection: the configuration (what is armed), the live status
 * snapshot (what the devices are doing), and the `faults:config` channel the
 * simulator pushes on every configuration change — including ones made by
 * another operator or by a startup env var.
 */
export class FaultSegment {
  constructor(private deps: ClientDeps) {
    this.getFaults = this.getFaults.bind(this);
    this.configureFaults = this.configureFaults.bind(this);
    this.getFaultStatus = this.getFaultStatus.bind(this);
    this.resetFaults = this.resetFaults.bind(this);
    this.setVehicleFaultProfile = this.setVehicleFaultProfile.bind(this);
    this.clearVehicleFaultProfile = this.clearVehicleFaultProfile.bind(this);
    this.onFaultsConfig = this.onFaultsConfig.bind(this);
    this.offFaultsConfig = this.offFaultsConfig.bind(this);
  }

  /** Configuration plus a live status snapshot, in one request. */
  async getFaults(): Promise<ApiResponse<DeviceFaultState>> {
    return this.deps.http.get<DeviceFaultState>("/faults");
  }

  async configureFaults(patch: FaultConfigPatch): Promise<ApiResponse<DeviceFaultConfig>> {
    return this.deps.http.post<FaultConfigPatch, DeviceFaultConfig>("/faults", patch);
  }

  async getFaultStatus(): Promise<ApiResponse<DeviceFaultStatus>> {
    return this.deps.http.get<DeviceFaultStatus>("/faults/status");
  }

  /** Clears latched device state (dead batteries, frozen windows) — not the config. */
  async resetFaults(): Promise<ApiResponse<DeviceFaultStatus>> {
    return this.deps.http.post<undefined, DeviceFaultStatus>("/faults/reset");
  }

  async setVehicleFaultProfile(
    vehicleId: string,
    profile: DeviceFaultProfile
  ): Promise<ApiResponse<DeviceFaultConfig>> {
    return this.deps.http.put<DeviceFaultProfile, DeviceFaultConfig>(
      `/faults/vehicles/${vehicleId}`,
      profile
    );
  }

  async clearVehicleFaultProfile(vehicleId: string): Promise<ApiResponse<DeviceFaultConfig>> {
    return this.deps.http.delete<DeviceFaultConfig>(`/faults/vehicles/${vehicleId}`);
  }

  onFaultsConfig(handler: (data: DeviceFaultConfig) => void): void {
    this.deps.ws.on("faults:config", handler);
  }

  offFaultsConfig(handler?: (data: DeviceFaultConfig) => void): void {
    this.deps.ws.off("faults:config", handler);
  }
}
