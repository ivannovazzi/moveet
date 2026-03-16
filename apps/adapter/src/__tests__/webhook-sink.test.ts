import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebhookSink } from "../plugins/sinks/webhook";

vi.mock("../utils/httpClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/httpClient")>();
  return {
    ...actual,
    httpFetch: vi.fn(),
  };
});

import { httpFetch } from "../utils/httpClient";
const mockHttpFetch = vi.mocked(httpFetch);

describe("WebhookSink", () => {
  beforeEach(() => {
    mockHttpFetch.mockReset();
    mockHttpFetch.mockResolvedValue(new Response("", { status: 200 }));
  });

  it("has correct type and name", () => {
    const sink = new WebhookSink();
    expect(sink.type).toBe("webhook");
    expect(sink.name).toBe("Generic Webhook");
  });

  it("requires url", async () => {
    const sink = new WebhookSink();
    await expect(sink.connect({})).rejects.toThrow("Webhook sink requires url");
  });

  it("posts updates to configured URL", async () => {
    const sink = new WebhookSink();
    await sink.connect({ url: "https://example.com/webhook" });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);

    expect(mockHttpFetch).toHaveBeenCalledWith(
      "https://example.com/webhook",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
        body: expect.stringContaining("v1"),
      })
    );
  });

  it("includes custom headers", async () => {
    const sink = new WebhookSink();
    await sink.connect({ url: "https://example.com/webhook", headers: { "X-Api-Key": "secret" } });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);

    expect(mockHttpFetch).toHaveBeenCalledWith(
      "https://example.com/webhook",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Api-Key": "secret" }),
      })
    );
  });

  it("does nothing after disconnect", async () => {
    const sink = new WebhookSink();
    await sink.connect({ url: "https://example.com/webhook" });
    await sink.disconnect();
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);
    expect(mockHttpFetch).not.toHaveBeenCalled();
  });

  it("health check reflects connection state", async () => {
    const sink = new WebhookSink();
    expect((await sink.healthCheck()).healthy).toBe(false);

    mockHttpFetch.mockResolvedValue(new Response("", { status: 200 }));
    await sink.connect({ url: "https://example.com/webhook" });
    expect((await sink.healthCheck()).healthy).toBe(true);

    await sink.disconnect();
    expect((await sink.healthCheck()).healthy).toBe(false);
  });

  it("has config schema with required url", () => {
    const sink = new WebhookSink();
    const urlField = sink.configSchema.find((f) => f.name === "url");
    expect(urlField).toBeDefined();
    expect(urlField!.required).toBe(true);
  });
});
