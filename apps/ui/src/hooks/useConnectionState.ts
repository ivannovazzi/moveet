import { useEffect, useState } from "react";
import client from "@/utils/client";
import type { ConnectionStateInfo } from "@/utils/wsClient";

const initialState: ConnectionStateInfo = {
  state: "connecting",
  attempt: 0,
  maxAttempts: 10,
};

export function useConnectionState(): ConnectionStateInfo {
  const [info, setInfo] = useState<ConnectionStateInfo>(initialState);

  useEffect(() => {
    const unsubscribe = client.onConnectionStateChange(setInfo);
    return unsubscribe;
  }, []);

  return info;
}
