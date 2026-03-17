import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookSink } from "./webhook";

vi.mock("../../utils/httpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/httpClient")>();
  return {
    ...actual,
    httpFetch: vi.fn(),
  };
});

import { httpFetch, HttpTimeoutError, HttpClientError } from "../../utils/httpClient";
const mockHttpFetch = vi.mocked(httpFetch);

describe("WebhookSink health check", () => {
  let sink: WebhookSink;

  beforeEach(() => {
    sink = new WebhookSink();
    mockHttpFetch.mockReset();
  });

  it("reports unhealthy when not connected", async () => {
    const result = await sink.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.message).toBeDefined();
  });

  it("reports healthy when URL is reachable", async () => {
    mockHttpFetch.mockResolvedValue(new Response("", { status: 200 }));
    await sink.connect({ url: "http://example.com/hook" });

    const result = await sink.healthCheck();

    expect(result.healthy).toBe(true);
    expect(mockHttpFetch).toHaveBeenCalled();
  });

  it("reports unhealthy when URL is unreachable", async () => {
    mockHttpFetch.mockRejectedValue(new HttpClientError("ECONNREFUSED", undefined, false));
    await sink.connect({ url: "http://unreachable.local/hook" });

    const result = await sink.healthCheck();

    expect(result.healthy).toBe(false);
    expect(result.message).toContain("ECONNREFUSED");
  });
});

describe("WebhookSink publishUpdates timeout", () => {
  let sink: WebhookSink;

  beforeEach(async () => {
    sink = new WebhookSink();
    mockHttpFetch.mockReset();
  });

  it("propagates timeout errors from httpFetch", async () => {
    mockHttpFetch.mockRejectedValue(new HttpTimeoutError("http://slow.example.com/hook", 10000));

    await sink.connect({ url: "http://slow.example.com/hook" });
    await expect(
      sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }])
    ).rejects.toThrow("timed out");
  });

  it("passes correct options to httpFetch during publishUpdates", async () => {
    mockHttpFetch.mockResolvedValue(new Response("", { status: 200 }));

    await sink.connect({ url: "http://example.com/hook" });
    await sink.publishUpdates([{ id: "v1", latitude: -1.28, longitude: 36.8 }]);

    expect(mockHttpFetch).toHaveBeenCalledWith(
      "http://example.com/hook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: expect.stringContaining("v1"),
      })
    );
  });
});
