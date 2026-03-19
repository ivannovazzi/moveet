import { useState, useEffect, useCallback } from "react";
import client from "@/utils/client";
import type { RecordingFile, RecordingMetadata } from "@/types";

export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<RecordingFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshRecordings = useCallback(async () => {
    try {
      const res = await client.getRecordings();
      if (res.error) {
        setError(res.error);
        console.warn("useRecording: refreshRecordings failed", res.error);
        return;
      }
      if (res.data) setRecordings(res.data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useRecording: refreshRecordings failed", msg);
    }
  }, []);

  useEffect(() => {
    refreshRecordings();
  }, [refreshRecordings]);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const res = await client.startRecording();
      if (res.error) {
        setError(res.error);
        console.warn("useRecording: startRecording failed", res.error);
        return;
      }
      if (res.data) setIsRecording(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useRecording: startRecording failed", msg);
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<RecordingMetadata | undefined> => {
    setError(null);
    try {
      const res = await client.stopRecording();
      if (res.error) {
        setError(res.error);
        console.warn("useRecording: stopRecording failed", res.error);
        setIsRecording(false);
        return undefined;
      }
      setIsRecording(false);
      await refreshRecordings();
      return res.data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      console.warn("useRecording: stopRecording failed", msg);
      setIsRecording(false);
      return undefined;
    }
  }, [refreshRecordings]);

  return { isRecording, recordings, startRecording, stopRecording, refreshRecordings, error };
}
