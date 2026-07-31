import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useJobDraft } from "./useJobDraft";
import type { CreateJobRequest, JobDTO } from "@/types";

// Map clicks are [lng, lat] — deck.gl's order, and what `onMapClick` hands over.
const PICKUP: [number, number] = [36.82, -1.29];
const DROPOFF: [number, number] = [36.85, -1.31];

let createJob: ReturnType<typeof vi.fn>;

beforeEach(() => {
  createJob = vi.fn().mockResolvedValue({ id: "job-1" } as JobDTO);
});

describe("useJobDraft", () => {
  it("starts idle and consumes no clicks", () => {
    const { result } = renderHook(() => useJobDraft(createJob));

    expect(result.current.stage).toBe("idle");
    expect(result.current.active).toBe(false);
    expect(result.current.handleMapClick(PICKUP)).toBe(false);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("takes the first click as the pickup without submitting", () => {
    const { result } = renderHook(() => useJobDraft(createJob));

    act(() => result.current.start());
    let consumed = false;
    act(() => {
      consumed = result.current.handleMapClick(PICKUP);
    });

    expect(consumed).toBe(true);
    expect(result.current.stage).toBe("dropoff");
    // Stored in the app's [lat, lng], like every other position — `JobsLayer`
    // flips it back to deck order to draw the draft marker.
    expect(result.current.pickup).toEqual([PICKUP[1], PICKUP[0]]);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("submits on the second click and returns to idle", async () => {
    const { result } = renderHook(() => useJobDraft(createJob));

    act(() => result.current.start());
    act(() => void result.current.handleMapClick(PICKUP));
    await act(async () => {
      result.current.handleMapClick(DROPOFF);
    });

    expect(createJob).toHaveBeenCalledTimes(1);
    const request = createJob.mock.calls[0][0] as CreateJobRequest;
    // …and the request is lat/lng, so the click order is flipped exactly once.
    // Sending it through unflipped made every job land at (36.8, -1.3), which the
    // simulator rejects as outside the road network bounds.
    expect(request.pickup).toEqual({ lat: PICKUP[1], lng: PICKUP[0] });
    expect(request.dropoff).toEqual({ lat: DROPOFF[1], lng: DROPOFF[0] });
    expect(result.current.stage).toBe("idle");
    expect(result.current.pickup).toBeNull();
  });

  it("sends the chosen strategy and SLA on the submitted job", async () => {
    const { result } = renderHook(() => useJobDraft(createJob));

    act(() => {
      result.current.setStrategy("best_eta");
      result.current.setSlaMinutes(4);
      result.current.start();
    });
    act(() => void result.current.handleMapClick(PICKUP));
    await act(async () => {
      result.current.handleMapClick(DROPOFF);
    });

    const request = createJob.mock.calls[0][0] as CreateJobRequest;
    expect(request.strategy).toBe("best_eta");
    expect(request.slaSeconds).toBe(240);
  });

  it("never submits a non-positive SLA", async () => {
    const { result } = renderHook(() => useJobDraft(createJob));

    act(() => {
      result.current.setSlaMinutes(0);
      result.current.start();
    });
    act(() => void result.current.handleMapClick(PICKUP));
    await act(async () => {
      result.current.handleMapClick(DROPOFF);
    });

    const request = createJob.mock.calls[0][0] as CreateJobRequest;
    expect(request.slaSeconds).toBe(1);
  });

  it("discards a half-placed job on cancel", () => {
    const { result } = renderHook(() => useJobDraft(createJob));

    act(() => result.current.start());
    act(() => void result.current.handleMapClick(PICKUP));
    act(() => result.current.cancel());

    expect(result.current.stage).toBe("idle");
    expect(result.current.pickup).toBeNull();
    expect(result.current.handleMapClick(DROPOFF)).toBe(false);
    expect(createJob).not.toHaveBeenCalled();
  });

  it("restarts placement rather than reusing a stale pickup", () => {
    const { result } = renderHook(() => useJobDraft(createJob));

    act(() => result.current.start());
    act(() => void result.current.handleMapClick(PICKUP));
    // A second start() re-enters at the pickup step with no pickup held.
    act(() => result.current.start());

    expect(result.current.stage).toBe("pickup");
    expect(result.current.pickup).toBeNull();
  });

  it("clears the submitting flag once the create settles", async () => {
    let release: (value: JobDTO | null) => void = () => {};
    createJob.mockReturnValue(
      new Promise<JobDTO | null>((resolve) => {
        release = resolve;
      })
    );
    const { result } = renderHook(() => useJobDraft(createJob));

    act(() => result.current.start());
    act(() => void result.current.handleMapClick(PICKUP));
    act(() => void result.current.handleMapClick(DROPOFF));
    expect(result.current.submitting).toBe(true);

    await act(async () => release({ id: "job-1" } as JobDTO));

    expect(result.current.submitting).toBe(false);
  });

  it("keeps handleMapClick stable across SLA edits", () => {
    const { result } = renderHook(() => useJobDraft(createJob));
    const first = result.current.handleMapClick;

    act(() => result.current.setSlaMinutes(42));

    expect(result.current.handleMapClick).toBe(first);
  });
});

describe("stepping back", () => {
  it("returns to the pickup step and drops the placed pickup", () => {
    const { result } = renderHook(() => useJobDraft(vi.fn()));

    act(() => result.current.start());
    act(() => {
      result.current.handleMapClick([1, 2]);
    });
    expect(result.current.stage).toBe("dropoff");
    // Click order in, app order stored.
    expect(result.current.pickup).toEqual([2, 1]);

    act(() => result.current.back());

    // Placing the pickup wrongly used to cost the whole draft: cancel, restart.
    expect(result.current.stage).toBe("pickup");
    expect(result.current.pickup).toBeNull();
  });

  it("does nothing from the pickup step or while idle", () => {
    const { result } = renderHook(() => useJobDraft(vi.fn()));

    act(() => result.current.back());
    expect(result.current.stage).toBe("idle");

    act(() => result.current.start());
    act(() => result.current.back());
    expect(result.current.stage).toBe("pickup");
  });
});
