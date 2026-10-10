import { useNetworkContext } from "@/data/useData";
import { handleMapStatus, useMapRevision } from "@/data/mapRevision";
import { resetBuildingsData } from "@/Map/Buildings/buildingsData";
import client from "@/utils/client";
import { fetchUntil } from "@/utils/fetchWithRetry";
import type { MapStatusPayload } from "@/utils/wsTypes";
import { useEffect, useState } from "react";

export function useNetwork() {
  const { network, setNetwork } = useNetworkContext();
  const [loading, setLoading] = useState(true);
  const mapRevision = useMapRevision();

  // The simulator can switch maps at runtime. Track the active one here (this
  // hook is mounted once, at the app root) so every map-derived fetch below
  // and in useRoads/usePois/the buildings layer reloads when it changes.
  useEffect(() => {
    const onMap = (payload: MapStatusPayload) => {
      if (handleMapStatus(payload)) resetBuildingsData();
    };
    client.onMap(onMap);
    return () => client.offMap(onMap);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `mapRevision` is the refetch trigger, not an input.
  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    fetchUntil(() => client.getNetwork().then((r) => r.data ?? null), {
      signal: ac.signal,
      maxRetries: Infinity,
    }).then((data) => {
      if (data) {
        setNetwork(data);
        setLoading(false);
      }
    });
    return () => ac.abort();
  }, [setNetwork, mapRevision]);

  return { network, loading };
}
