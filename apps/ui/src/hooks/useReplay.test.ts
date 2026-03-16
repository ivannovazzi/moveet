import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReplay } from "./useReplay";
import client from "@/utils/client";
import type { ReplayStatus } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    onReplayStatus: vi.fn(),
    startReplay: vi.fn(),
    pauseReplay: vi.fn(),
    resumeReplay: vi.fn(),
    stopReplay: vi.fn(),
    seekReplay: vi.fn(),
    setReplaySpeed: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.onReplayStatus).mockImplementation(() => {});
  vi.mocked(client.startReplay).mockResolvedValue({ data: undefined });
  vi.mocked(client.pauseReplay).mockResolvedValue({ data: undefined });
  vi.mocked(client.resumeReplay).mockResolvedValue({ data: undefined });
  vi.mocked(client.stopReplay).mockResolvedValue({ data: undefined });
  vi.mocked(client.seekReplay).mockResolvedValue({ data: undefined });
  vi.mocked(client.setReplaySpeed).mockResolvedValue({ data: undefined });
});

describe("useReplay", () => {
  it("initializes with live mode replay status", () => {
    const { result } = renderHook(() => useReplay());

    expect(result.current.replayStatus).toEqual({ mode: "live" });
  });

  it("subscribes to WS replay status updates on mount", () => {
    renderHook(() => useReplay());

    expect(client.onReplayStatus).toHaveBeenCalledOnce();
  });

  it("updates replayStatus when WS sends a status update", () => {
    const { result } = renderHook(() => useReplay());

    const handler = vi.mocked(client.onReplayStatus).mock.calls[0][0];
    const wsStatus: ReplayStatus = {
      mode: "replay",
      file: "recording.json",
      progress: 0.5,
      duration: 120000,
      currentTime: 60000,
      speed: 2,
      paused: false,
    };

    act(() => {
      handler(wsStatus);
    });

    expect(result.current.replayStatus).toEqual(wsStatus);
  });

  it("startReplay calls client.startReplay with file and speed", async () => {
    const { result } = renderHook(() => useReplay());

    await act(async () => {
      await result.current.startReplay("recording.json", 2);
    });

    expect(client.startReplay).toHaveBeenCalledWith("recording.json", 2);
  });

  it("startReplay calls client.startReplay with file only (no speed)", async () => {
    const { result } = renderHook(() => useReplay());

    await act(async () => {
      await result.current.startReplay("recording.json");
    });

    expect(client.startReplay).toHaveBeenCalledWith("recording.json", undefined);
  });

  it("pauseReplay calls client.pauseReplay", async () => {
    const { result } = renderHook(() => useReplay());

    await act(async () => {
      await result.current.pauseReplay();
    });

    expect(client.pauseReplay).toHaveBeenCalledOnce();
  });

  it("resumeReplay calls client.resumeReplay", async () => {
    const { result } = renderHook(() => useReplay());

    await act(async () => {
      await result.current.resumeReplay();
    });

    expect(client.resumeReplay).toHaveBeenCalledOnce();
  });

  it("stopReplay calls client.stopReplay", async () => {
    const { result } = renderHook(() => useReplay());

    await act(async () => {
      await result.current.stopReplay();
    });

    expect(client.stopReplay).toHaveBeenCalledOnce();
  });

  it("seekReplay calls client.seekReplay with timestamp", async () => {
    const { result } = renderHook(() => useReplay());

    await act(async () => {
      await result.current.seekReplay(45000);
    });

    expect(client.seekReplay).toHaveBeenCalledWith(45000);
  });

  it("setReplaySpeed calls client.setReplaySpeed with speed", async () => {
    const { result } = renderHook(() => useReplay());

    await act(async () => {
      await result.current.setReplaySpeed(4);
    });

    expect(client.setReplaySpeed).toHaveBeenCalledWith(4);
  });

  it("tracks multiple WS status transitions", () => {
    const { result } = renderHook(() => useReplay());

    const handler = vi.mocked(client.onReplayStatus).mock.calls[0][0];

    act(() => {
      handler({ mode: "replay", file: "rec.json", paused: false, speed: 1 });
    });
    expect(result.current.replayStatus.mode).toBe("replay");

    act(() => {
      handler({ mode: "replay", file: "rec.json", paused: true, speed: 1 });
    });
    expect(result.current.replayStatus.paused).toBe(true);

    act(() => {
      handler({ mode: "live" });
    });
    expect(result.current.replayStatus).toEqual({ mode: "live" });
  });
});
