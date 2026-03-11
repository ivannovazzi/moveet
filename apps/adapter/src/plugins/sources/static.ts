import type { ConfigField, DataSource, HealthCheckResult, PluginConfig } from "../types";
import type { ExportVehicle, Fleet } from "../../types";

export class StaticSource implements DataSource {
  readonly type = "static";
  readonly name = "Static Test Data";
  readonly configSchema: ConfigField[] = [
    { name: "count", label: "Count", type: "number", default: 10 },
  ];
  private vehicles: ExportVehicle[] = [];
  private fleets: Fleet[] = [];

  async connect(config: PluginConfig): Promise<void> {
    const count = (config.count as number) || 10;
    this.vehicles = Array.from({ length: count }, (_, i) => ({
      id: `static-${i}`,
      name: `Test Vehicle ${i + 1}`,
      position: [-1.28 + Math.random() * 0.1, 36.8 + Math.random() * 0.1] as [number, number],
    }));

    const half = Math.ceil(count / 2);
    this.fleets = [
      {
        id: "static-fleet-alpha",
        name: "Alpha Fleet",
        color: "#e6194b",
        source: "external" as const,
        vehicleIds: this.vehicles.slice(0, half).map((v) => v.id),
      },
      {
        id: "static-fleet-bravo",
        name: "Bravo Fleet",
        color: "#3cb44b",
        source: "external" as const,
        vehicleIds: this.vehicles.slice(half).map((v) => v.id),
      },
    ];
  }

  async disconnect(): Promise<void> {
    this.vehicles = [];
    this.fleets = [];
  }

  async getVehicles(): Promise<ExportVehicle[]> {
    return this.vehicles;
  }

  async getFleets(): Promise<Fleet[]> {
    return this.fleets;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: true };
  }
}
