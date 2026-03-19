import { useRoadsContext } from "@/data/useData";
import client from "@/utils/client";
import { useEffect, useState } from "react";

export function useRoads() {
  const { roads, setRoads } = useRoadsContext();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client
      .getRoads()
      .then((response) => {
        if (response.data) setRoads(response.data.filter((road) => road.name !== ""));
      })
      .catch((err) => console.error("Failed to load roads:", err))
      .finally(() => setLoading(false));
  }, [setRoads]);

  return { roads, loading };
}
