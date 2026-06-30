import { describe, it, expect, vi } from "vitest";
import { chunk, sendChunksParallel, type ChunkPlan } from "./chunking";

describe("chunk", () => {
  it("splits into fixed-size chunks", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns one chunk for a non-positive size", () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });

  it("returns no chunks for an empty input", () => {
    expect(chunk([], 0)).toEqual([]);
    expect(chunk([], 5)).toEqual([]);
  });
});

describe("sendChunksParallel", () => {
  const plan = (chunks: Array<() => Promise<number[]>>, total: number): ChunkPlan<number> => ({
    total,
    chunks,
  });

  it("sends all chunks and sums succeeded counts when all succeed", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const result = await sendChunksParallel(
      plan([() => Promise.resolve([1, 2]), () => Promise.resolve([3])], 3),
      send
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ attempted: 3, succeeded: 3, failures: [] });
  });

  it("attempts every chunk in parallel; a failed chunk doesn't abort the rest", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce(undefined) // chunk 0 ok
      .mockRejectedValueOnce(new Error("send failed")) // chunk 1 fails
      .mockResolvedValueOnce(undefined); // chunk 2 ok
    const result = await sendChunksParallel(
      plan(
        [() => Promise.resolve([1, 2]), () => Promise.resolve([3, 4]), () => Promise.resolve([5])],
        5
      ),
      send
    );
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.attempted).toBe(5);
    // chunk 0 (2) + chunk 2 (1) delivered; chunk 1 (2) dropped.
    expect(result.succeeded).toBe(3);
    expect(result.failures).toEqual([{ itemId: "chunk-1", error: "send failed" }]);
  });

  it("invokes the success/failure hooks per chunk", async () => {
    const onChunkSuccess = vi.fn();
    const onChunkFailure = vi.fn();
    const send = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("nope"));
    await sendChunksParallel(
      plan([() => Promise.resolve([1, 2]), () => Promise.resolve([3])], 3),
      send,
      { onChunkSuccess, onChunkFailure }
    );
    expect(onChunkSuccess).toHaveBeenCalledWith(2);
    expect(onChunkFailure).toHaveBeenCalledWith(0, "nope");
  });
});
