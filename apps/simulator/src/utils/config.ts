import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config();

function parseNumber(value: string | undefined, defaultValue: number, name: string): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (isNaN(parsed)) {
    throw new Error(`Invalid number for ${name}: ${value}`);
  }
  return parsed;
}

export const config = {
  port: parseNumber(process.env.PORT, 5010, "PORT"),
  updateInterval: parseNumber(process.env.UPDATE_INTERVAL, 500, "UPDATE_INTERVAL"),
  minSpeed: parseNumber(process.env.MIN_SPEED, 20, "MIN_SPEED"),
  maxSpeed: parseNumber(process.env.MAX_SPEED, 60, "MAX_SPEED"),
  acceleration: parseNumber(process.env.ACCELERATION, 5, "ACCELERATION"),
  deceleration: parseNumber(process.env.DECELERATION, 7, "DECELERATION"),
  turnThreshold: parseNumber(process.env.TURN_THRESHOLD, 30, "TURN_THRESHOLD"),
  speedVariation: parseNumber(process.env.SPEED_VARIATION, 0.1, "SPEED_VARIATION"),
  heatZoneSpeedFactor: parseNumber(process.env.HEATZONE_SPEED_FACTOR, 0.5, "HEATZONE_SPEED_FACTOR"),
  syncAdapterTimeout: parseNumber(process.env.SYNC_ADAPTER_TIMEOUT, 5000, "SYNC_ADAPTER_TIMEOUT"),
  vehicleCount: parseNumber(process.env.VEHICLE_COUNT, 70, "VEHICLE_COUNT"),
  geojsonPath: process.env.GEOJSON_PATH || "./export.geojson",
  adapterURL: process.env.ADAPTER_URL || "",
} as const;

export function verifyConfig(): void {
  // Validate geojsonPath
  if (!config.geojsonPath) {
    throw new Error("Missing required environment variable: GEOJSON_PATH");
  }

  const resolvedPath = path.resolve(config.geojsonPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`GeoJSON file not found at path: ${resolvedPath}`);
  }

  // Validate numeric ranges
  if (config.port < 1 || config.port > 65535) {
    throw new Error(`PORT must be between 1 and 65535, got: ${config.port}`);
  }

  if (config.updateInterval < 1) {
    throw new Error(`UPDATE_INTERVAL must be positive, got: ${config.updateInterval}`);
  }

  if (config.minSpeed < 0) {
    throw new Error(`MIN_SPEED must be non-negative, got: ${config.minSpeed}`);
  }

  if (config.maxSpeed <= config.minSpeed) {
    throw new Error(
      `MAX_SPEED (${config.maxSpeed}) must be greater than MIN_SPEED (${config.minSpeed})`
    );
  }

  if (config.speedVariation < 0 || config.speedVariation > 1) {
    throw new Error(`SPEED_VARIATION must be between 0 and 1, got: ${config.speedVariation}`);
  }

  if (config.heatZoneSpeedFactor < 0 || config.heatZoneSpeedFactor > 1) {
    throw new Error(
      `HEATZONE_SPEED_FACTOR must be between 0 and 1, got: ${config.heatZoneSpeedFactor}`
    );
  }

  if (config.syncAdapterTimeout < 0) {
    throw new Error(`SYNC_ADAPTER_TIMEOUT must be non-negative, got: ${config.syncAdapterTimeout}`);
  }

  if (config.vehicleCount < 1) {
    throw new Error(`VEHICLE_COUNT must be at least 1, got: ${config.vehicleCount}`);
  }
}
