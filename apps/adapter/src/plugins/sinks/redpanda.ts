import { randomUUID } from "node:crypto";
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
    { name: "batchSize", label: "Batch Size", type: "number", default: 500 },
    {
      name: "acks",
      label: "Acks",
      type: "select",
      default: 1,
      options: [
        { label: "None (0)", value: "0" },
        { label: "Leader (1)", value: "1" },
        { label: "All (-1)", value: "-1" },
      ],
    },
  ];
  private producer: Producer | null = null;
  private topic = "dispatch.vehicle.positions";
  private batchSize = 500;
  private acks: number = 1;

  async connect(config: PluginConfig): Promise<void> {
    const brokers = ((config.brokers as string) || "localhost:19092").split(",");
    this.topic = (config.topic as string) || "dispatch.vehicle.positions";
    this.batchSize = (config.batchSize as number) || 500;
    this.acks = config.acks != null ? Number(config.acks) : 1;

    const kafka = new Kafka({
      clientId: "moveet-adapter",
      brokers,
    });

    this.producer = kafka.producer({ allowAutoTopicCreation: false });
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
        eventId: randomUUID(),
        occurredOn: now,
        vehicleId: update.id,
        vehicleType: update.type,
        latitude: update.latitude,
        longitude: update.longitude,
        timestamp: now,
      }),
    }));

    if (messages.length <= this.batchSize) {
      await this.producer.send({ topic: this.topic, messages, acks: this.acks });
    } else {
      const chunks: (typeof messages)[] = [];
      for (let i = 0; i < messages.length; i += this.batchSize) {
        chunks.push(messages.slice(i, i + this.batchSize));
      }
      await Promise.all(
        chunks.map((chunk) => this.producer!.send({ topic: this.topic, messages: chunk, acks: this.acks }))
      );
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.producer) return { healthy: false, message: "producer not initialized" };
    return { healthy: true, message: "producer connected" };
  }
}
