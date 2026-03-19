import type { Scenario, ScenarioEvent, ScenarioAction } from "./types";
import type { RecordingHeader, RecordingEvent } from "../../types";

// ─── Public interface ──────────────────────────────────────────────

export interface ConvertOptions {
  name?: string;
  description?: string;
}

/**
 * Converts a parsed NDJSON recording into a repeatable scenario.
 *
 * Extracts user-initiated events (spawns, incidents, dispatches) and
 * discards per-tick noise (vehicle positions, heatzones, waypoints, etc.).
 * Spawns within a 1-second window are aggregated into a single
 * `spawn_vehicles` action.
 */
export function convertRecordingToScenario(
  header: RecordingHeader,
  events: RecordingEvent[],
  options?: ConvertOptions
): Scenario {
  const scenarioEvents: ScenarioEvent[] = [];

  // 1. Extract a set_options event at t=0 from the header
  scenarioEvents.push({
    at: 0,
    action: {
      type: "set_options" as const,
      options: header.options,
    },
  });

  // 2. Walk events and convert relevant ones
  const spawnBuffer: Array<{ timestampMs: number; data: Record<string, unknown> }> = [];

  for (const event of events) {
    switch (event.type) {
      case "spawn":
        spawnBuffer.push({ timestampMs: event.timestamp, data: event.data });
        break;

      case "incident": {
        if (event.data.action !== "created") break;
        const action = buildIncidentAction(event.data);
        if (action) {
          scenarioEvents.push({ at: msToSeconds(event.timestamp), action });
        }
        break;
      }

      case "direction": {
        const action = buildDispatchAction(event.data);
        if (action) {
          scenarioEvents.push({ at: msToSeconds(event.timestamp), action });
        }
        break;
      }

      // All other event types are discarded
      default:
        break;
    }
  }

  // 3. Aggregate spawns into time-windowed batches
  const spawnActions = aggregateSpawns(spawnBuffer);
  for (const sa of spawnActions) {
    scenarioEvents.push(sa);
  }

  // 4. Sort all events by time
  scenarioEvents.sort((a, b) => a.at - b.at);

  // 5. Compute duration: last event timestamp + 60s buffer
  const lastEventAt = scenarioEvents.length > 0 ? scenarioEvents[scenarioEvents.length - 1].at : 0;
  const duration = lastEventAt + 60;

  return {
    name: options?.name ?? `Recording ${header.startTime}`,
    description: options?.description,
    city: undefined,
    version: 1,
    events: scenarioEvents,
    duration,
  };
}

// ─── NDJSON parser ─────────────────────────────────────────────────

/**
 * Parses raw NDJSON text into a recording header + event array.
 */
export function parseRecording(ndjson: string): {
  header: RecordingHeader;
  events: RecordingEvent[];
} {
  const lines = ndjson.split("\n").filter((l) => l.trim());
  if (lines.length === 0) {
    throw new Error("Empty recording file");
  }
  const header = JSON.parse(lines[0]) as RecordingHeader;
  const events = lines.slice(1).map((l) => JSON.parse(l) as RecordingEvent);
  return { header, events };
}

// ─── Helpers ───────────────────────────────────────────────────────

function msToSeconds(ms: number): number {
  return Math.round(ms / 1000);
}

/**
 * Aggregates individual spawn events into batched `spawn_vehicles` actions.
 * Spawns within a 1-second window (1000 ms) are merged into a single action.
 */
function aggregateSpawns(
  spawns: Array<{ timestampMs: number; data: Record<string, unknown> }>
): ScenarioEvent[] {
  if (spawns.length === 0) return [];

  // Sort by timestamp
  const sorted = [...spawns].sort((a, b) => a.timestampMs - b.timestampMs);

  const result: ScenarioEvent[] = [];
  let windowStart = sorted[0].timestampMs;
  let count = 0;
  const vehicleTypes: Record<string, number> = {};

  function flushWindow(atMs: number): void {
    if (count === 0) return;
    const action: ScenarioAction = {
      type: "spawn_vehicles" as const,
      count,
      ...(Object.keys(vehicleTypes).length > 0 ? { vehicleTypes: { ...vehicleTypes } } : {}),
    };
    result.push({ at: msToSeconds(atMs), action });
  }

  for (const spawn of sorted) {
    if (spawn.timestampMs - windowStart > 1000) {
      flushWindow(windowStart);
      // Reset
      windowStart = spawn.timestampMs;
      count = 0;
      for (const key of Object.keys(vehicleTypes)) {
        delete vehicleTypes[key];
      }
    }
    count++;
    const vType = spawn.data.vehicleType as string | undefined;
    if (vType) {
      vehicleTypes[vType] = (vehicleTypes[vType] ?? 0) + 1;
    }
  }

  // Flush last window
  flushWindow(windowStart);

  return result;
}

function buildIncidentAction(data: Record<string, unknown>): ScenarioAction | null {
  const incidentType = data.type as string | undefined;
  if (!incidentType || !["accident", "closure", "construction"].includes(incidentType)) {
    return null;
  }

  const duration = typeof data.duration === "number" ? data.duration : 120;
  const severity = typeof data.severity === "number" ? data.severity : undefined;
  const edgeIds = Array.isArray(data.edgeIds) ? (data.edgeIds as string[]) : undefined;
  const position =
    data.position && typeof data.position === "object"
      ? (data.position as { lat: number; lng: number })
      : undefined;

  // At least one of edgeIds or position must be present
  if (!edgeIds && !position) return null;

  return {
    type: "create_incident" as const,
    incidentType: incidentType as "accident" | "closure" | "construction",
    duration,
    ...(severity !== undefined ? { severity } : {}),
    ...(edgeIds ? { edgeIds } : {}),
    ...(position ? { position } : {}),
  };
}

function buildDispatchAction(data: Record<string, unknown>): ScenarioAction | null {
  const vehicleId = data.vehicleId as string | undefined;
  if (!vehicleId) return null;

  // Extract waypoints from direction data
  const waypoints = data.waypoints as
    | Array<{ lat: number; lng: number; dwellTime?: number; label?: string }>
    | undefined;
  if (!waypoints || waypoints.length === 0) return null;

  return {
    type: "dispatch" as const,
    vehicleId,
    waypoints: waypoints.map((wp) => ({
      lat: wp.lat,
      lng: wp.lng,
      ...(wp.dwellTime !== undefined ? { dwellTime: wp.dwellTime } : {}),
      ...(wp.label !== undefined ? { label: wp.label } : {}),
    })),
  };
}
