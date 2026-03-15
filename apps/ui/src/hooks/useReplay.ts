import { useState, useEffect, useCallback } from "react";
import client from "@/utils/client";
import type { ReplayStatus } from "@/types";

export function useReplay() {
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>({ mode: "live" });

  useEffect(() => {
    client.onReplayStatus((data) => {
      setReplayStatus(data);
    });
  }, []);

  const startReplay = useCallback(async (file: string, speed?: number) => {
    await client.startReplay(file, speed);
  }, []);

  const pauseReplay = useCallback(async () => {
    await client.pauseReplay();
  }, []);

  const resumeReplay = useCallback(async () => {
    await client.resumeReplay();
  }, []);

  const stopReplay = useCallback(async () => {
    await client.stopReplay();
  }, []);

  const seekReplay = useCallback(async (timestamp: number) => {
    await client.seekReplay(timestamp);
  }, []);

  const setReplaySpeed = useCallback(async (speed: number) => {
    await client.setReplaySpeed(speed);
  }, []);

  return { replayStatus, startReplay, pauseReplay, resumeReplay, stopReplay, seekReplay, setReplaySpeed };
}
