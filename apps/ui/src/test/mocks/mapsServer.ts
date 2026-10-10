import { vi } from "vitest";
import type { MapMeta } from "@moveet/shared-types";

/**
 * A fake simulator for the Maps panel tests: `fetch` is replaced by a router
 * keyed on `"METHOD /path"` (query string included when the route names one,
 * else matched on the path alone). A route answers with a fixed reply or a
 * function of the request; unrouted requests answer 404, which is exactly what
 * an older simulator says about the build endpoints.
 */
export interface Reply {
  status?: number;
  body?: unknown;
}

type Route = Reply | ((init: { url: URL; body: unknown }) => Reply | Promise<Reply>);

export const API = "http://localhost:5010";

export function mockMapsServer(routes: Record<string, Route>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const path = url.pathname;
    calls.push({ method, path: path + url.search, body });
    const route = routes[`${method} ${path}${url.search}`] ?? routes[`${method} ${path}`];
    const reply: Reply = route
      ? typeof route === "function"
        ? await route({ url, body })
        : route
      : { status: 404, body: { error: `Cannot ${method} ${path}` } };
    const status = reply.status ?? 200;
    const text = reply.body === undefined ? "" : JSON.stringify(reply.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text),
      text: async () => text,
    } as Response;
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return { fetchMock, calls };
}

export function makeMap(overrides: Partial<MapMeta> = {}): MapMeta {
  return {
    id: "nairobi",
    label: "Nairobi",
    bbox: [36.7, -1.4, 36.95, -1.2],
    source: { type: "bundled" },
    sizes: { networkBytes: 4 * 1024 * 1024, buildingsBytes: 0 },
    featureCount: 12000,
    nodeCount: 30000,
    hasBuildings: false,
    createdAt: "2026-10-01T10:00:00Z",
    ...overrides,
  };
}

export const LIMITS = {
  maxAreaKm2: 2500,
  diskQuotaBytes: 5 * 1024 ** 3,
  diskUsedBytes: 1024 ** 3,
  cacheBytes: 0,
  maxQueuedJobs: 3,
};

/** `GET /maps` as a server with build support answers it. */
export function libraryBody(
  maps: MapMeta[],
  activeId: string,
  extra: Record<string, unknown> = { buildsAllowed: true, buildLimits: LIMITS }
) {
  return { maps, activeId, switching: false, ...extra };
}
