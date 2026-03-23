import { useState, useEffect, useCallback } from "react";
import client from "@/utils/client";
import type { ReplayStatus } from "@/types";

export function useReplay() {
  const [replayStatus, setReplayStatus] = useState<ReplayStatus>({ mode: "live" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handler = (data: ReplayStatus) => {
      setReplayStatus(data);
    };
    client.onReplayStatus(handler);

    return () => {
      client.offReplayStatus(handler);
    };
  }, []);

  const startReplay = useCallback(async (file: string, speed?: number) => {
    setError(null);
    try {
      const res = await client.startReplay(file, speed);
      if (res.error) {
        setError(res.error);
        console.warn("useReplay: startReplay failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useReplay: startReplay failed", msg);
    }
  }, []);

  const pauseReplay = useCallback(async () => {
    setError(null);
    try {
      const res = await client.pauseReplay();
      if (res.error) {
        setError(res.error);
        console.warn("useReplay: pauseReplay failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useReplay: pauseReplay failed", msg);
    }
  }, []);

  const resumeReplay = useCallback(async () => {
    setError(null);
    try {
      const res = await client.resumeReplay();
      if (res.error) {
        setError(res.error);
        console.warn("useReplay: resumeReplay failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useReplay: resumeReplay failed", msg);
    }
  }, []);

  const stopReplay = useCallback(async () => {
    setError(null);
    try {
      const res = await client.stopReplay();
      if (res.error) {
        setError(res.error);
        console.warn("useReplay: stopReplay failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useReplay: stopReplay failed", msg);
    }
  }, []);

  const seekReplay = useCallback(async (timestamp: number) => {
    setError(null);
    try {
      const res = await client.seekReplay(timestamp);
      if (res.error) {
        setError(res.error);
        console.warn("useReplay: seekReplay failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useReplay: seekReplay failed", msg);
    }
  }, []);

  const setReplaySpeed = useCallback(async (speed: number) => {
    setError(null);
    try {
      const res = await client.setReplaySpeed(speed);
      if (res.error) {
        setError(res.error);
        console.warn("useReplay: setReplaySpeed failed", res.error);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useReplay: setReplaySpeed failed", msg);
    }
  }, []);

  return {
    replayStatus,
    startReplay,
    pauseReplay,
    resumeReplay,
    stopReplay,
    seekReplay,
    setReplaySpeed,
    error,
  };
}
