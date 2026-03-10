import type { ConfigField, DataSink, HealthCheckResult, PluginConfig } from "../types";
import type { VehicleUpdate } from "../../types";

export class ConsoleSink implements DataSink {
  readonly type = "console";
  readonly name = "Console Logger";
  readonly configSchema: ConfigField[] = [
    { name: "verbose", label: "Verbose", type: "boolean", default: false },
  ];
  private verbose = false;

  async connect(config: PluginConfig): Promise<void> {
    this.verbose = (config.verbose as boolean) || false;
  }

  async disconnect(): Promise<void> {}

  async publishUpdates(updates: VehicleUpdate[]): Promise<void> {
    if (this.verbose) {
      console.log(`[ConsoleSink] ${updates.length} updates:`, JSON.stringify(updates, null, 2));
    } else {
      console.log(`[ConsoleSink] ${updates.length} vehicle updates published`);
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    return { healthy: true };
  }
}
