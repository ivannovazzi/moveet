import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getHealth,
  getConfig,
  setSource,
  addSink,
  removeSink,
  setRealism,
  emitRecording,
  getEmitStatus,
  AdapterHttpError,
} from "./adapterClient";

const BASE_URL = "http://localhost:5011";

const mockHealthResponse = {
  source: { type: "static", healthy: true },
  sinks: [{ type: "console", healthy: true }],
  availableSources: [{ type: "static", configSchema: [] }],
  availableSinks: [{ type: "console", configSchema: [] }],
};

const mockConfigResponse = {
  activeSource: "static",
  activeSinks: ["console"],
  sourceConfig: { static: { interval: 1000 } },
  sinkConfig: { console: {} },
  status: mockHealthResponse,
};

const mockMutationResponse = {
  ok: true,
  status: mockHealthResponse,
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

beforeEach(() => {
  vi.restoreAllMocks();
  globalThis.fetch = vi.fn();
});

describe("getHealth", () => {
  it("fetches /health with correct URL and headers", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mockHealthResponse));

    const result = await getHealth();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/health`, {
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
    });
    expect(result).toEqual(mockHealthResponse);
  });

  it("passes through realism status when present", async () => {
    const realism = {
      enabled: true,
      devices: 3,
      connected: 2,
      degraded: 1,
      disconnected: 0,
      buffered: 5,
    };
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ ...mockHealthResponse, realism }));

    const result = await getHealth();

    expect(result.realism).toEqual(realism);
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 500));

    await expect(getHealth()).rejects.toThrow("Adapter GET /health: 500");
  });
});

describe("getConfig", () => {
  it("fetches /config with correct URL and headers", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mockConfigResponse));

    const result = await getConfig();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/config`, {
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
    });
    expect(result).toEqual(mockConfigResponse);
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 503));

    await expect(getConfig()).rejects.toThrow("Adapter GET /config: 503");
  });
});

describe("setSource", () => {
  it("posts to /config/source with type and config", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mockMutationResponse));
    const config = { interval: 2000 };

    const result = await setSource("static", config);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/config/source`, {
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "static", config }),
    });
    expect(result).toEqual(mockMutationResponse);
  });

  it("posts with undefined config when omitted", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mockMutationResponse));

    await setSource("static");

    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/config/source`, {
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "static", config: undefined }),
    });
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 400));

    await expect(setSource("bad")).rejects.toThrow("Adapter POST /config/source: 400");
  });
});

describe("addSink", () => {
  it("posts to /config/sinks with type and config", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mockMutationResponse));
    const config = { topic: "vehicles" };

    const result = await addSink("kafka", config);

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/config/sinks`, {
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "kafka", config }),
    });
    expect(result).toEqual(mockMutationResponse);
  });

  it("posts with undefined config when omitted", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mockMutationResponse));

    await addSink("console");

    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/config/sinks`, {
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "console", config: undefined }),
    });
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 422));

    await expect(addSink("bad")).rejects.toThrow("Adapter POST /config/sinks: 422");
  });
});

describe("removeSink", () => {
  it("sends DELETE to /config/sinks/:type", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mockMutationResponse));

    const result = await removeSink("console");

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/config/sinks/console`, {
      method: "DELETE",
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
    });
    expect(result).toEqual(mockMutationResponse);
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 404));

    await expect(removeSink("missing")).rejects.toThrow(
      "Adapter DELETE /config/sinks/missing: 404"
    );
  });
});

describe("setRealism", () => {
  it("posts to /config/realism with config body", async () => {
    const realismResponse = { ok: true, realism: { config: {}, schema: [], status: {} } };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(realismResponse));

    const result = await setRealism({ enabled: true });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/config/realism`, {
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: { enabled: true } }),
    });
    expect(result).toEqual(realismResponse);
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 400));

    await expect(setRealism({})).rejects.toThrow("Adapter POST /config/realism: 400");
  });
});

describe("emitRecording", () => {
  it("posts to /replay/emit with recordingId and realism", async () => {
    const accepted = { status: "emitting", jobId: "job-1" };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(accepted, 202));

    const result = await emitRecording({ recordingId: 7, realism: "on" });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/replay/emit`, {
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: 7, realism: "on" }),
    });
    expect(result).toEqual(accepted);
  });

  it("includes seed when provided", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: "emitting", jobId: "j" }, 202));

    await emitRecording({ recordingId: 1, realism: "off", seed: 42 });

    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/replay/emit`, {
      method: "POST",
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: 1, realism: "off", seed: 42 }),
    });
  });

  it("throws AdapterHttpError carrying status 409 when already emitting", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 409));

    await expect(emitRecording({ recordingId: 1, realism: "on" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(emitRecording({ recordingId: 1, realism: "on" })).rejects.toBeInstanceOf(
      AdapterHttpError
    );
  });
});

describe("getEmitStatus", () => {
  it("fetches /replay/emit/status", async () => {
    const status = { state: "emitting", emitted: 10, total: 100, pct: 10 };
    vi.mocked(fetch).mockResolvedValue(jsonResponse(status));

    const result = await getEmitStatus();

    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/replay/emit/status`, {
      signal: expect.any(AbortSignal),
      headers: { "Content-Type": "application/json" },
    });
    expect(result).toEqual(status);
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 500));

    await expect(getEmitStatus()).rejects.toThrow("Adapter GET /replay/emit/status: 500");
  });
});

describe("request timeout", () => {
  it("throws a timeout error when fetch is aborted", async () => {
    vi.useFakeTimers();

    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    });

    const promise = getHealth();
    // Prevent Node's unhandled-rejection warning during timer advance
    promise.catch(() => {});
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(promise).rejects.toThrow("Adapter /health: request timed out");

    vi.useRealTimers();
  });
});
