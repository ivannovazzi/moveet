import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to test config.ts in isolation, so we reset modules between tests
// and control import.meta.env via vi.stubEnv.

describe("UI config validation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  async function importConfig() {
    const mod = await import("./config");
    return mod.config;
  }

  it("uses defaults when no VITE_* env vars are set", async () => {
    const cfg = await importConfig();
    expect(cfg.apiUrl).toBe("http://localhost:5010");
    expect(cfg.wsUrl).toBe("ws://localhost:5010");
    expect(cfg.adapterUrl).toBe("http://localhost:5011");
  });

  it("uses custom VITE_API_URL when set", async () => {
    vi.stubEnv("VITE_API_URL", "http://custom-api:8080");
    const cfg = await importConfig();
    expect(cfg.apiUrl).toBe("http://custom-api:8080");
    vi.unstubAllEnvs();
  });

  it("uses custom VITE_WS_URL when set", async () => {
    vi.stubEnv("VITE_WS_URL", "ws://custom-ws:9090");
    const cfg = await importConfig();
    expect(cfg.wsUrl).toBe("ws://custom-ws:9090");
    vi.unstubAllEnvs();
  });

  it("uses custom VITE_ADAPTER_URL when set", async () => {
    vi.stubEnv("VITE_ADAPTER_URL", "http://custom-adapter:7070");
    const cfg = await importConfig();
    expect(cfg.adapterUrl).toBe("http://custom-adapter:7070");
    vi.unstubAllEnvs();
  });

  it("throws on invalid VITE_API_URL", async () => {
    vi.stubEnv("VITE_API_URL", "not-a-url");
    await expect(importConfig()).rejects.toThrow(/Invalid URL for VITE_API_URL/);
    vi.unstubAllEnvs();
  });

  it("throws on invalid VITE_WS_URL", async () => {
    vi.stubEnv("VITE_WS_URL", "not-a-url");
    await expect(importConfig()).rejects.toThrow(/Invalid URL for VITE_WS_URL/);
    vi.unstubAllEnvs();
  });

  it("throws on invalid VITE_ADAPTER_URL", async () => {
    vi.stubEnv("VITE_ADAPTER_URL", "not-a-url");
    await expect(importConfig()).rejects.toThrow(/Invalid URL for VITE_ADAPTER_URL/);
    vi.unstubAllEnvs();
  });

  it("config object is frozen (immutable)", async () => {
    const cfg = await importConfig();
    expect(Object.isFrozen(cfg)).toBe(true);
  });
});
