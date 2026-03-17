import { useNetworkContext } from "@/data/useData";
import client from "@/utils/client";
import { useEffect } from "react";

export function useNetwork() {
  const { network, setNetwork } = useNetworkContext();

  useEffect(() => {
    client.getNetwork().then((response) => {
      if (response.data) setNetwork(response.data);
    });
  }, [setNetwork]);

  return network;
}
