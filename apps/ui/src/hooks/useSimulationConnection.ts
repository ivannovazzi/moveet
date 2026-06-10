import { useEffect, useState } from "react";
import client from "@/utils/client";
import type { SimulationStatus, VehicleDTO } from "@/types";
import type { ResetPayload } from "@/utils/wsTypes";
import { analyticsStore } from "./analyticsStore";
import type { AnalyticsSnapshot } from "./analyticsStore";

interface UseSimulationConnectionOptions {
  /** Replace the vehicle list (initial load, reconnect resync, reset). */
  setVehicles: (vehicles: VehicleDTO[]) => void;
  /**
   * Called when the simulation resets so the caller can clear local UI state
   * (selection, destination, ...). Must be referentially stable.
   */
  onReset: (data: ResetPayload) => void;
}

/**
 * Owns the WebSocket lifecycle and connection-level state: connected flag,
 * simulation status, analytics feed, and full-state resync on (re)connect.
 *
 * Extracted from App.tsx — behavior preserved verbatim.
 */
export function useSimulationConnection({ setVehicles, onReset }: UseSimulationConnectionOptions) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<SimulationStatus>({
    interval: 0,
    running: false,
    ready: false,
  });

  // Initial vehicle load
  useEffect(() => {
    client.getVehicles().then((response) => {
      if (response.error) {
        console.error("Failed to fetch vehicles:", response.error);
        return;
      }
      if (response.data) {
        setVehicles(response.data);
      }
    });
  }, [setVehicles]);

  useEffect(() => {
    // Register named handlers so cleanup can remove exactly these — passing no
    // handler to off* deletes the whole handler set for that event type, which
    // would also wipe handlers other hooks (e.g. useDirections) registered for
    // the shared "connect"/"reset" events.
    const handleConnect = () => {
      setConnected(true);
      analyticsStore.clear();
      // Re-fetch full state on reconnect
      client.getVehicles().then((response) => {
        if (response.data) setVehicles(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    const handleAnalytics = (snapshot: AnalyticsSnapshot) => analyticsStore.push(snapshot);
    const handleStatus = (data: SimulationStatus) => setStatus(data);
    const handleReset = (data: ResetPayload) => {
      setVehicles(data.vehicles);
      onReset(data);
    };

    client.onConnect(handleConnect);
    client.onDisconnect(handleDisconnect);
    client.onAnalytics(handleAnalytics);
    client.onStatus(handleStatus);
    client.onReset(handleReset);
    client.getStatus().then((response) => {
      if (response.data) {
        setStatus(response.data);
      }
    });

    client.connectWebSocket();
    return () => {
      client.offConnect(handleConnect);
      client.offDisconnect(handleDisconnect);
      client.offAnalytics(handleAnalytics);
      client.offStatus(handleStatus);
      client.offReset(handleReset);
      client.disconnect();
    };
  }, [setVehicles, onReset]);

  return { connected, status };
}
