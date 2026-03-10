import useData from "@/data/useData";
import client from "@/utils/client";
import { useEffect } from "react";

export function useHeatzones() {
  const { heatzones, setHeatzones } = useData();

  useEffect(() => {
    client
      .getHeatzones()
      .then((heatzonesData) => {
        if (heatzonesData.data) setHeatzones(heatzonesData.data);
      })
      .catch((err) => console.error("Failed to load heatzones:", err));
    client.onHeatzones((heatzones) => {
      setHeatzones(heatzones);
    });
  }, [setHeatzones]);

  return heatzones;
}
