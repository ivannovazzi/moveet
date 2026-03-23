import { useHeatZoneContext } from "@/data/useData";
import type { Heatzone } from "@/types";
import client from "@/utils/client";
import { useEffect } from "react";

export function useHeatzones() {
  const { heatzones, setHeatzones } = useHeatZoneContext();

  useEffect(() => {
    client
      .getHeatzones()
      .then((heatzonesData) => {
        if (heatzonesData.data) setHeatzones(heatzonesData.data);
      })
      .catch((err) => console.error("Failed to load heatzones:", err));

    const handler = (heatzones: Heatzone[]) => {
      setHeatzones(heatzones);
    };
    client.onHeatzones(handler);

    return () => {
      client.offHeatzones(handler);
    };
  }, [setHeatzones]);

  return heatzones;
}
