import { useRoadsContext } from "@/data/useData";
import client from "@/utils/client";
import { useEffect } from "react";

export function useRoads() {
  const { roads, setRoads } = useRoadsContext();

  useEffect(() => {
    client
      .getRoads()
      .then((response) => {
        if (response.data) setRoads(response.data.filter((road) => road.name !== ""));
      })
      .catch((err) => console.error("Failed to load roads:", err));
  }, [setRoads]);

  return { roads };
}
