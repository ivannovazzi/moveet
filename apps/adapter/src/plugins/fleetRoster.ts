/**
 * In-process fleet roster shared between the `connector` source plugin (which
 * populates it from the connector's compacted AVRO topics) and the `redpanda`
 * sink in `trajectory` format (which reads it to key telemetry by the *real*
 * device id the connector advertises, rather than a synthetic vehicle id).
 *
 * ## Why a shared module rather than passing data through the simulator
 *
 * The adapter's source and sink plugins are deliberately decoupled — the
 * simulator drives movement by `vehicleId` and only ever round-trips the
 * vehicle id back to the sink on `POST /sync`. The trajectory engine, however,
 * resolves telemetry by `deviceId → vehicleId` using the connector's
 * `trajectory.fleet.assignment` bindings, so the sink needs the
 * `vehicleId → deviceId` mapping that only the source knows. This singleton is
 * the smallest bridge that lets the sink look up the device(s) currently bound
 * to a vehicle without inventing a new cross-plugin transport.
 *
 * It is intentionally a process-global singleton: there is exactly one active
 * source and one set of sinks per adapter process.
 */

/** A device currently bound to a vehicle, with the binding source. */
export interface BoundDevice {
  deviceId: string;
  source: "fitted_gps" | "shift";
}

/**
 * Snapshot of the fleet as advertised by the connector: the set of known
 * vehicles and, for each, the device(s) currently bound to it.
 */
export interface FleetRosterSnapshot {
  /** All vehicle ids the connector has advertised (whether bound or not). */
  vehicleIds: string[];
  /** vehicleId → device(s) currently bound to that vehicle. */
  devicesByVehicle: Map<string, BoundDevice[]>;
}

class FleetRoster {
  /** vehicleId → metadata (presence = vehicle is known). */
  private vehicles = new Set<string>();
  /** deviceId → its current binding (vehicleId + source). null = unbound. */
  private bindings = new Map<string, { vehicleId: string; source: "fitted_gps" | "shift" }>();

  /** Record (or update) a vehicle the connector advertises. */
  upsertVehicle(vehicleId: string): void {
    this.vehicles.add(vehicleId);
  }

  /**
   * Apply a device→vehicle assignment. A null/empty `vehicleId` unbinds the
   * device (last-writer-wins, matching the compacted-topic semantics: the
   * latest record per device key is authoritative).
   */
  applyAssignment(
    deviceId: string,
    vehicleId: string | null,
    source: "fitted_gps" | "shift"
  ): void {
    if (vehicleId) {
      this.bindings.set(deviceId, { vehicleId, source });
      // A binding implies the vehicle exists even if its vehicle event was
      // compacted away or arrives later.
      this.vehicles.add(vehicleId);
    } else {
      this.bindings.delete(deviceId);
    }
  }

  /** Device(s) currently bound to a vehicle (empty when none). */
  devicesForVehicle(vehicleId: string): BoundDevice[] {
    const out: BoundDevice[] = [];
    for (const [deviceId, binding] of this.bindings) {
      if (binding.vehicleId === vehicleId) {
        out.push({ deviceId, source: binding.source });
      }
    }
    return out;
  }

  /** Vehicle ids that currently have at least one bound device. */
  boundVehicleIds(): string[] {
    const bound = new Set<string>();
    for (const binding of this.bindings.values()) {
      bound.add(binding.vehicleId);
    }
    return [...bound];
  }

  /** Full immutable-ish snapshot for diagnostics / source listing. */
  snapshot(): FleetRosterSnapshot {
    const devicesByVehicle = new Map<string, BoundDevice[]>();
    for (const [deviceId, binding] of this.bindings) {
      const list = devicesByVehicle.get(binding.vehicleId) ?? [];
      list.push({ deviceId, source: binding.source });
      devicesByVehicle.set(binding.vehicleId, list);
    }
    return { vehicleIds: [...this.vehicles], devicesByVehicle };
  }

  /** Clear all state (called when the connector source disconnects). */
  clear(): void {
    this.vehicles.clear();
    this.bindings.clear();
  }
}

/** Process-wide shared roster instance. */
export const fleetRoster = new FleetRoster();
