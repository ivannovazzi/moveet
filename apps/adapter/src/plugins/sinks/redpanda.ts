import type { Producer } from "kafkajs";
import { Kafka } from "kafkajs";
import type { ConfigField, DataSink, HealthCheckResult, PluginConfig } from "../types";
import type { VehicleUpdate } from "../../types";

export class RedpandaSink implements DataSink {
  readonly type = "redpanda";
  readonly name = "Redpanda/Kafka Message Broker";
  readonly configSchema: ConfigField[] = [
    {
      name: "brokers",
      label: "Brokers",
      type: "string",
      required: true,
      default: "localhost:19092",
      placeholder: "host1:9092,host2:9092",
    },
    { name: "topic", label: "Topic", type: "string", default: "dispatch.vehicle.positions" },
  ];
  private producer: Producer | null = null;
  private topic = "dispatch.vehicle.positions";

  async connect(config: PluginConfig): Promise<void> {
    const brokers = ((config.brokers as string) || "localhost:19092").split(",");
    this.topic = (config.topic as string) || "dispatch.vehicle.positions";

    const kafka = new Kafka({
      clientId: "moveet-adapter",
      brokers,
    });

    this.producer = kafka.producer();
    await this.producer.connect();
  }

  async disconnect(): Promise<void> {
    if (this.producer) {
      await this.producer.disconnect();
      this.producer = null;
    }
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<void> {
    if (!this.producer) return;

    const now = new Date().toISOString();
    const messages = updates.map((update) => ({
      key: update.id,
      value: JSON.stringify({
        eventType: "vehicle.position",
        eventId: `vehicle.position-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        occurredOn: now,
        vehicleId: update.id,
        latitude: update.latitude,
        longitude: update.longitude,
        timestamp: now,
      }),
    }));

    await this.producer.send({ topic: this.topic, messages });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.producer) return { healthy: false, message: "producer not initialized" };
    return { healthy: true, message: "producer connected" };
  }
}
