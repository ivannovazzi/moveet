import { useCallback, useEffect, useRef, useState } from "react";
import client from "@/utils/client";
import { toast } from "@/lib/toast";
import type { FaultConfigPatch } from "@/utils/client/faults";
import type { DeviceFaultConfig, DeviceFaultProfile, DeviceFaultStatus } from "@/types";

/**
 * How often the live device counters are re-read while the panel is on screen.
 *
 * Status is a snapshot of continuously-moving state (frozen windows opening and
 * closing, batteries draining) with no push channel, so it is polled — but only
 * while something is watching, and never for the configuration, which arrives on
 * `faults:config` the moment it changes.
 */
const STATUS_POLL_MS = 2000;

export interface UseFaults {
  config: DeviceFaultConfig | null;
  status: DeviceFaultStatus | null;
  /** True until the first snapshot lands. */
  loading: boolean;
  error: string | null;
  configure: (patch: FaultConfigPatch) => Promise<void>;
  setVehicleProfile: (vehicleId: string, profile: DeviceFaultProfile) => Promise<void>;
  clearVehicleProfile: (vehicleId: string) => Promise<void>;
  /** Clears latched device state (dead batteries, frozen windows), keeping the config. */
  reset: () => Promise<void>;
}

/**
 * The device fault layer, as an operator surface.
 *
 * The configuration is authoritative on the simulator: it can also be set by an
 * env var at boot or by another client, so this hook treats `faults:config` as
 * the source of truth rather than trusting its own last write. A simulation reset
 * drops per-device state (but not the config), so it refetches both.
 *
 * @param live Whether the live status counters should be polled — pass the
 *   panel's visibility so a closed panel costs nothing.
 */
export function useFaults(live: boolean): UseFaults {
  const [config, setConfig] = useState<DeviceFaultConfig | null>(null);
  const [status, setStatus] = useState<DeviceFaultStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Guards every async setState against a unmount mid-flight.
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    const load = () => {
      client
        .getFaults()
        .then((res) => {
          if (!mounted.current) return;
          if (res.error || !res.data) {
            setError(res.error ?? "Failed to load fault configuration");
            return;
          }
          const { status: snapshot, ...rest } = res.data;
          setConfig(rest);
          setStatus(snapshot);
          setError(null);
        })
        .finally(() => {
          if (mounted.current) setLoading(false);
        });
    };

    load();

    const onConfig = (pushed: DeviceFaultConfig) => setConfig(pushed);
    client.onFaultsConfig(onConfig);
    client.onReset(load);

    return () => {
      mounted.current = false;
      client.offFaultsConfig(onConfig);
      client.offReset(load);
    };
  }, []);

  useEffect(() => {
    if (!live) return;
    const poll = () => {
      client.getFaultStatus().then((res) => {
        if (!mounted.current || !res.data) return;
        setStatus(res.data);
      });
    };
    const interval = setInterval(poll, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [live]);

  /** Runs a mutation that answers with the resolved configuration. */
  const applyConfig = useCallback(
    async (
      run: () => Promise<{ data?: DeviceFaultConfig; error?: string }>,
      successMessage?: string
    ) => {
      const res = await run();
      if (res.error || !res.data) {
        const message = res.error ?? "Fault update failed";
        setError(message);
        toast.error(message);
        return;
      }
      setConfig(res.data);
      setError(null);
      if (successMessage) toast.success(successMessage);
    },
    []
  );

  const configure = useCallback(
    (patch: FaultConfigPatch) => applyConfig(() => client.configureFaults(patch)),
    [applyConfig]
  );

  const setVehicleProfile = useCallback(
    (vehicleId: string, profile: DeviceFaultProfile) =>
      applyConfig(() => client.setVehicleFaultProfile(vehicleId, profile)),
    [applyConfig]
  );

  const clearVehicleProfile = useCallback(
    (vehicleId: string) => applyConfig(() => client.clearVehicleFaultProfile(vehicleId)),
    [applyConfig]
  );

  const reset = useCallback(async () => {
    const res = await client.resetFaults();
    if (res.error || !res.data) {
      const message = res.error ?? "Failed to reset device state";
      setError(message);
      toast.error(message);
      return;
    }
    setStatus(res.data);
    toast.success("Device state cleared");
  }, []);

  return {
    config,
    status,
    loading,
    error,
    configure,
    setVehicleProfile,
    clearVehicleProfile,
    reset,
  };
}
