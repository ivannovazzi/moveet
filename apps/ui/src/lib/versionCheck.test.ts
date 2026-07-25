import { describe, it, expect, vi, afterEach } from "vitest";
import {
  currentBuildId,
  fetchDeployedBuildId,
  shouldNotifyUpdate,
  versionUrl,
  VERSION_FILE,
} from "./versionCheck";

function jsonResponse(body: string, init: { ok?: boolean } = {}) {
  return {
    ok: init.ok ?? true,
    text: async () => body,
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("versionUrl", () => {
  it("resolves against a root base", () => {
    expect(versionUrl("/")).toBe(`/${VERSION_FILE}`);
  });

  it("adds the missing separator for a sub-path base", () => {
    expect(versionUrl("/app")).toBe(`/app/${VERSION_FILE}`);
    expect(versionUrl("/app/")).toBe(`/app/${VERSION_FILE}`);
  });
});

describe("currentBuildId", () => {
  it("is empty when the bundle carries no stamp", () => {
    expect(currentBuildId()).toBe("");
  });

  it("returns the baked-in stamp", () => {
    vi.stubEnv("VITE_BUILD_ID", "abc123");
    expect(currentBuildId()).toBe("abc123");
  });
});

describe("shouldNotifyUpdate", () => {
  it("notifies only when both ids are known and differ", () => {
    expect(shouldNotifyUpdate("a", "b")).toBe(true);
  });

  it("stays quiet when the ids match", () => {
    expect(shouldNotifyUpdate("a", "a")).toBe(false);
  });

  it("stays quiet when either side is unknown", () => {
    expect(shouldNotifyUpdate("", "b")).toBe(false);
    expect(shouldNotifyUpdate("a", null)).toBe(false);
    expect(shouldNotifyUpdate("", null)).toBe(false);
  });
});

describe("fetchDeployedBuildId", () => {
  it("reads buildId from version.json and bypasses the HTTP cache", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(JSON.stringify({ buildId: "deployed-1" })));
    await expect(
      fetchDeployedBuildId(fetchImpl as unknown as typeof fetch, "/version.json")
    ).resolves.toBe("deployed-1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^\/version\.json\?t=\d+$/);
    expect(init.cache).toBe("no-store");
  });

  it("returns null on a non-ok response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse("", { ok: false }));
    await expect(
      fetchDeployedBuildId(fetchImpl as unknown as typeof fetch, "/version.json")
    ).resolves.toBeNull();
  });

  it("returns null when the SPA fallback serves index.html instead", async () => {
    // Caddy's `try_files {path} /index.html` answers 200 with HTML when the
    // file is missing — that must read as "unknown", never as "changed".
    const fetchImpl = vi.fn(async () => jsonResponse("<!doctype html><html></html>"));
    await expect(
      fetchDeployedBuildId(fetchImpl as unknown as typeof fetch, "/version.json")
    ).resolves.toBeNull();
  });

  it("returns null when buildId is missing or not a string", async () => {
    const missing = vi.fn(async () => jsonResponse(JSON.stringify({})));
    const wrongType = vi.fn(async () => jsonResponse(JSON.stringify({ buildId: 7 })));
    await expect(
      fetchDeployedBuildId(missing as unknown as typeof fetch, "/version.json")
    ).resolves.toBeNull();
    await expect(
      fetchDeployedBuildId(wrongType as unknown as typeof fetch, "/version.json")
    ).resolves.toBeNull();
  });

  it("returns null when the network throws", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      fetchDeployedBuildId(fetchImpl as unknown as typeof fetch, "/version.json")
    ).resolves.toBeNull();
  });
});
