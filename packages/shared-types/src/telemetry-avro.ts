// ─── Canonical Telemetry AVRO Schema ────────────────────────────────
//
// The platform's canonical telemetry-ingest envelope, published Confluent-AVRO
// encoded to `telemetry.device.raw`. Field order and types MUST match the
// platform's registered schema exactly — do not reorder or retype fields.

/**
 * Confluent-AVRO schema for the canonical `telemetry.location.reported` event.
 * Registered under subject `telemetry.device.raw-telemetry.location.reported`.
 */
export const TELEMETRY_LOCATION_AVRO_SCHEMA = {
  type: "record",
  name: "TelemetryLocationEvent",
  namespace: "telemetry.ingest",
  fields: [
    { name: "event_id", type: "string" },
    { name: "event_type", type: "string" },
    { name: "event_version", type: "int" },
    { name: "occurred_at", type: "string" },
    {
      name: "source",
      type: {
        type: "record",
        name: "EventSource",
        fields: [
          { name: "service", type: "string" },
          { name: "environment", type: "string" },
        ],
      },
    },
    {
      name: "metadata",
      type: {
        type: "record",
        name: "EventMetadata",
        fields: [
          { name: "correlation_id", type: ["null", "string"], default: null },
          { name: "causation_id", type: ["null", "string"], default: null },
          { name: "trace_id", type: ["null", "string"], default: null },
        ],
      },
    },
    {
      name: "data",
      type: {
        type: "record",
        name: "TelemetryLocationData",
        fields: [
          { name: "device_id", type: "string" },
          { name: "source", type: { type: "enum", name: "TelemetrySource", symbols: ["GPS", "MOBILE"] } },
          { name: "recorded_at", type: "string" },
          { name: "latitude", type: "double" },
          { name: "longitude", type: "double" },
          { name: "accuracy_meters", type: ["null", "double"], default: null },
          { name: "speed_mps", type: ["null", "double"], default: null },
          { name: "heading_degrees", type: ["null", "double"], default: null },
          { name: "altitude_meters", type: ["null", "double"], default: null },
          { name: "satellites", type: ["null", "int"], default: null },
          { name: "ignition_on", type: ["null", "boolean"], default: null },
          { name: "moving", type: ["null", "boolean"], default: null },
          { name: "battery_level", type: ["null", "double"], default: null },
          { name: "battery_charging", type: ["null", "boolean"], default: null },
          { name: "network", type: ["null", "string"], default: null },
          {
            name: "position_origin",
            type: ["null", { type: "enum", name: "PositionOrigin", symbols: ["GPS", "NETWORK", "PASSIVE", "UNKNOWN"] }],
            default: null,
          },
          { name: "sensor_readings", type: { type: "map", values: "string" }, default: {} },
        ],
      },
    },
  ],
} as const;

/** Subject under which the canonical schema is registered in Schema Registry. */
export const TELEMETRY_LOCATION_AVRO_SUBJECT =
  "telemetry.device.raw-telemetry.location.reported";

/** Canonical `event_type` for telemetry location reports. */
export const TELEMETRY_LOCATION_EVENT_TYPE = "telemetry.location.reported";
