import { useNetworkContext } from "@/data/useData";
import client from "@/utils/client";
import { useEffect, useState } from "react";

export function useNetwork() {
  const { network, setNetwork } = useNetworkContext();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    client
      .getNetwork()
      .then((response) => {
        if (response.error) {
          console.warn("useNetwork: failed to fetch network", response.error);
          return;
        }
        if (response.data) setNetwork(response.data);
      })
      .catch((e) => {
        const msg = e instanceof Error ? e.message : "Unknown error";
        console.warn("useNetwork: failed to fetch network", msg);
      })
      .finally(() => setLoading(false));
  }, [setNetwork]);

  return { network, loading };
}
