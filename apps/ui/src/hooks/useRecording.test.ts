import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRecording } from "./useRecording";
import client from "@/utils/client";
import type { RecordingFile, RecordingMetadata } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getRecordings: vi.fn(),
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
  },
}));

function createRecordingFile(overrides: Partial<RecordingFile> = {}): RecordingFile {
  return {
    fileName: "recording-2026-01-01.json",
    fileSize: 1024,
    modifiedAt: "2026-01-01T12:00:00Z",
    ...overrides,
  };
}

function createRecordingMetadata(overrides: Partial<RecordingMetadata> = {}): RecordingMetadata {
  return {
    filePath: "/recordings/recording-2026-01-01.json",
    startTime: "2026-01-01T12:00:00Z",
    duration: 60000,
    eventCount: 500,
    fileSize: 2048,
    vehicleCount: 10,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getRecordings).mockResolvedValue({ data: [] });
  vi.mocked(client.startRecording).mockResolvedValue({ data: undefined });
  vi.mocked(client.stopRecording).mockResolvedValue({ data: undefined });
});

describe("useRecording", () => {
  it("initializes with isRecording=false and empty recordings", () => {
    const { result } = renderHook(() => useRecording());

    expect(result.current.isRecording).toBe(false);
    expect(result.current.recordings).toEqual([]);
  });

  it("fetches recordings on mount", async () => {
    const file1 = createRecordingFile({ fileName: "rec-1.json" });
    const file2 = createRecordingFile({ fileName: "rec-2.json" });

    vi.mocked(client.getRecordings).mockResolvedValue({ data: [file1, file2] });

    const { result } = renderHook(() => useRecording());

    await vi.waitFor(() => {
      expect(result.current.recordings).toHaveLength(2);
    });

    expect(result.current.recordings).toEqual([file1, file2]);
  });

  it("handles getRecordings returning no data gracefully", async () => {
    vi.mocked(client.getRecordings).mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => useRecording());

    await vi.waitFor(() => {
      expect(client.getRecordings).toHaveBeenCalledOnce();
    });

    expect(result.current.recordings).toEqual([]);
  });

  it("startRecording sets isRecording=true on success", async () => {
    vi.mocked(client.startRecording).mockResolvedValue({
      data: { status: "recording", filePath: "/tmp/rec.json" },
    });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(true);
    expect(client.startRecording).toHaveBeenCalledOnce();
  });

  it("startRecording does not set isRecording when response has no data", async () => {
    vi.mocked(client.startRecording).mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.isRecording).toBe(false);
  });

  it("stopRecording sets isRecording=false, refreshes recordings, returns metadata", async () => {
    const metadata = createRecordingMetadata();
    vi.mocked(client.stopRecording).mockResolvedValue({ data: metadata });

    // Start with startRecording first
    vi.mocked(client.startRecording).mockResolvedValue({
      data: { status: "recording", filePath: "/tmp/rec.json" },
    });

    const updatedFiles = [createRecordingFile({ fileName: "new-rec.json" })];
    // First call for mount, second for refresh after stop
    vi.mocked(client.getRecordings)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: updatedFiles });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.isRecording).toBe(true);

    let returnedMetadata: RecordingMetadata | undefined;
    await act(async () => {
      returnedMetadata = await result.current.stopRecording();
    });

    expect(result.current.isRecording).toBe(false);
    expect(returnedMetadata).toEqual(metadata);
    // getRecordings called on mount + after stop
    expect(client.getRecordings).toHaveBeenCalledTimes(2);
  });

  it("refreshRecordings re-fetches the recordings list", async () => {
    const initialFiles = [createRecordingFile({ fileName: "old.json" })];
    const updatedFiles = [
      createRecordingFile({ fileName: "old.json" }),
      createRecordingFile({ fileName: "new.json" }),
    ];

    vi.mocked(client.getRecordings)
      .mockResolvedValueOnce({ data: initialFiles })
      .mockResolvedValueOnce({ data: updatedFiles });

    const { result } = renderHook(() => useRecording());

    await vi.waitFor(() => {
      expect(result.current.recordings).toHaveLength(1);
    });

    await act(async () => {
      await result.current.refreshRecordings();
    });

    expect(result.current.recordings).toHaveLength(2);
    expect(client.getRecordings).toHaveBeenCalledTimes(2);
  });
});

describe("useRecording error handling", () => {
  it("startRecording sets error on API error", async () => {
    vi.mocked(client.startRecording).mockResolvedValue({ error: "Already recording" });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });

    expect(result.current.error).toBe("Already recording");
    expect(result.current.isRecording).toBe(false);
  });

  it("stopRecording sets error on failure", async () => {
    vi.mocked(client.stopRecording).mockResolvedValue({ error: "Not recording" });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      const metadata = await result.current.stopRecording();
      expect(metadata).toBeUndefined();
    });

    expect(result.current.error).toBe("Not recording");
  });

  it("refreshRecordings sets error on failure", async () => {
    // First call on mount succeeds, second call (manual refresh) fails
    vi.mocked(client.getRecordings)
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ error: "Server unavailable" });

    const { result } = renderHook(() => useRecording());

    await vi.waitFor(() => {
      expect(client.getRecordings).toHaveBeenCalledOnce();
    });

    await act(async () => {
      await result.current.refreshRecordings();
    });

    expect(result.current.error).toBe("Server unavailable");
  });

  it("error clears on next successful operation", async () => {
    vi.mocked(client.startRecording).mockResolvedValue({ error: "Some error" });

    const { result } = renderHook(() => useRecording());

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.error).toBe("Some error");

    vi.mocked(client.startRecording).mockResolvedValue({
      data: { status: "recording", filePath: "/tmp/rec.json" },
    });

    await act(async () => {
      await result.current.startRecording();
    });
    expect(result.current.error).toBeNull();
  });
});
