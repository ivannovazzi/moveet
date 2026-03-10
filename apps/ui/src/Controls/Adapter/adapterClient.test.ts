import { describe, it, expect, vi, beforeEach } from "vitest";
import { getHealth, getConfig, setSource, addSink, removeSink } from "./adapterClient";

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
      headers: { "Content-Type": "application/json" },
    });
    expect(result).toEqual(mockHealthResponse);
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 500));

    await expect(getHealth()).rejects.toThrow("Adapter /health: 500");
  });
});

describe("getConfig", () => {
  it("fetches /config with correct URL and headers", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mockConfigResponse));

    const result = await getConfig();

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/config`, {
      headers: { "Content-Type": "application/json" },
    });
    expect(result).toEqual(mockConfigResponse);
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 503));

    await expect(getConfig()).rejects.toThrow("Adapter /config: 503");
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "static", config: undefined }),
    });
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 400));

    await expect(setSource("bad")).rejects.toThrow("Adapter /config/source: 400");
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "console", config: undefined }),
    });
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 422));

    await expect(addSink("bad")).rejects.toThrow("Adapter /config/sinks: 422");
  });
});

describe("removeSink", () => {
  it("sends DELETE to /config/sinks/:type", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(mockMutationResponse));

    const result = await removeSink("console");

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(`${BASE_URL}/config/sinks/console`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
    });
    expect(result).toEqual(mockMutationResponse);
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse(null, 404));

    await expect(removeSink("missing")).rejects.toThrow("Adapter /config/sinks/missing: 404");
  });
});
