import { useState, useEffect, useCallback } from "react";
import client from "@/utils/client";
import type { RecordingFile, RecordingMetadata } from "@/types";

export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordings, setRecordings] = useState<RecordingFile[]>([]);

  const refreshRecordings = useCallback(async () => {
    const res = await client.getRecordings();
    if (res.data) setRecordings(res.data);
  }, []);

  useEffect(() => {
    refreshRecordings();
  }, [refreshRecordings]);

  const startRecording = useCallback(async () => {
    const res = await client.startRecording();
    if (res.data) setIsRecording(true);
  }, []);

  const stopRecording = useCallback(async (): Promise<RecordingMetadata | undefined> => {
    const res = await client.stopRecording();
    setIsRecording(false);
    await refreshRecordings();
    return res.data;
  }, [refreshRecordings]);

  return { isRecording, recordings, startRecording, stopRecording, refreshRecordings };
}
