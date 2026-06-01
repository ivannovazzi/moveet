import type { ConnState } from "./models";

export interface RealismGpsConfig {
  connectedSigmaM: number;
  connectedTauS: number;
  degradedSigmaM: number;
  degradedTauS: number;
}

export interface RealismConnectivityConfig {
  meanConnectedS: number;
  meanDegradedS: number;
  meanDisconnectedS: number;
  degradedFromConnectedS: number;
}

export interface RealismConfig {
  enabled: boolean;
  /** Nominal telematics reporting period (ms). */
  reportingPeriodMs: number;
  /** Std-dev of Gaussian cadence jitter (ms), clamped so intervals stay > 0. */
  jitterMs: number;
  gps: RealismGpsConfig;
  connectivity: RealismConnectivityConfig;
  /** Buffer + burst on reconnect (true) vs drop samples during outage (false). */
  storeAndForward: boolean;
  maxBufferPerDevice: number;
  /** Optional deterministic seed (tests / reproducible runs). */
  seed?: number;
}

export interface DegradedSample {
  id: string;
  latitude: number;
  longitude: number;
  speed?: number;
  heading?: number;
  accuracy: number;
  timestamp: number;
  connected: boolean;
  metadata?: Record<string, unknown>;
}

export interface DeviceState {
  trueLat: number;
  trueLon: number;
  trueSpeed?: number;
  trueHeading?: number;
  metadata?: Record<string, unknown>;
  errEast: number;
  errNorth: number;
  conn: ConnState;
  lastStepAt: number;
  nextEmitAt: number;
  buffer: DegradedSample[];
}

export interface RealismStatus {
  enabled: boolean;
  devices: number;
  connected: number;
  degraded: number;
  disconnected: number;
  buffered: number;
}
