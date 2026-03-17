import { usePOIContext } from "@/data/useData";
import client from "@/utils/client";
import { useEffect } from "react";

export function usePois() {
  const { pois, setPOIs } = usePOIContext();

  useEffect(() => {
    client
      .getPois()
      .then((response) => {
        if (response.data) setPOIs(response.data);
      })
      .catch((err) => console.error("Failed to load POIs:", err));
  }, [setPOIs]);

  return { pois };
}
