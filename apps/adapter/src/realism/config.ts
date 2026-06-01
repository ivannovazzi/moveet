import type { ConfigField } from "../plugins/types";
import type { RealismConfig } from "./types";

export const DEFAULT_REALISM_CONFIG: RealismConfig = {
  enabled: false,
  reportingPeriodMs: 5000,
  jitterMs: 800,
  gps: {
    connectedSigmaM: 4,
    connectedTauS: 120,
    degradedSigmaM: 25,
    degradedTauS: 30,
  },
  connectivity: {
    meanConnectedS: 600,
    meanDegradedS: 45,
    meanDisconnectedS: 60,
    degradedFromConnectedS: 120,
  },
  storeAndForward: true,
  maxBufferPerDevice: 500,
};

function num(value: unknown, fallback: number, min = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < min) return fallback;
  return n;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}

/** Merge a partial config (e.g. from REST/env JSON) over defaults, clamping. */
export function resolveRealismConfig(input: Record<string, unknown>): RealismConfig {
  const d = DEFAULT_REALISM_CONFIG;
  const gps = (input.gps as Record<string, unknown>) ?? {};
  const conn = (input.connectivity as Record<string, unknown>) ?? {};
  const resolved: RealismConfig = {
    enabled: bool(input.enabled, d.enabled),
    reportingPeriodMs: num(input.reportingPeriodMs, d.reportingPeriodMs, 1),
    jitterMs: num(input.jitterMs, d.jitterMs, 0),
    gps: {
      connectedSigmaM: num(gps.connectedSigmaM, d.gps.connectedSigmaM),
      connectedTauS: num(gps.connectedTauS, d.gps.connectedTauS, 0.001),
      degradedSigmaM: num(gps.degradedSigmaM, d.gps.degradedSigmaM),
      degradedTauS: num(gps.degradedTauS, d.gps.degradedTauS, 0.001),
    },
    connectivity: {
      meanConnectedS: num(conn.meanConnectedS, d.connectivity.meanConnectedS, 0.001),
      meanDegradedS: num(conn.meanDegradedS, d.connectivity.meanDegradedS, 0.001),
      meanDisconnectedS: num(conn.meanDisconnectedS, d.connectivity.meanDisconnectedS, 0.001),
      degradedFromConnectedS: num(
        conn.degradedFromConnectedS,
        d.connectivity.degradedFromConnectedS,
        0.001
      ),
    },
    storeAndForward: bool(input.storeAndForward, d.storeAndForward),
    maxBufferPerDevice: num(input.maxBufferPerDevice, d.maxBufferPerDevice, 1),
  };
  if (input.seed != null && Number.isFinite(Number(input.seed))) {
    resolved.seed = Number(input.seed);
  }
  return resolved;
}

/** Self-describing schema the UI renders (mirrors sink configSchema pattern). */
export const REALISM_SCHEMA: ConfigField[] = [
  { name: "enabled", label: "Enabled", type: "boolean", default: false },
  {
    name: "reportingPeriodMs",
    label: "Reporting period (ms)",
    type: "number",
    default: 5000,
    description: "Nominal telematics emit period per device.",
  },
  {
    name: "jitterMs",
    label: "Cadence jitter (ms)",
    type: "number",
    default: 800,
  },
  {
    name: "gps",
    label: "GPS noise",
    type: "json",
    default: DEFAULT_REALISM_CONFIG.gps,
    description: "connectedSigmaM/TauS, degradedSigmaM/TauS",
  },
  {
    name: "connectivity",
    label: "Connectivity (mean seconds)",
    type: "json",
    default: DEFAULT_REALISM_CONFIG.connectivity,
    description: "meanConnectedS, meanDegradedS, meanDisconnectedS, degradedFromConnectedS",
  },
  {
    name: "storeAndForward",
    label: "Store & forward",
    type: "boolean",
    default: true,
  },
  {
    name: "maxBufferPerDevice",
    label: "Max buffer / device",
    type: "number",
    default: 500,
  },
];
