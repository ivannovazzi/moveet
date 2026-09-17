import { describe, it, expect, afterEach, vi } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import WebSocket from "ws";
import { setupWebSocket } from "../../setup/websocket";
import { WeatherManager, type FetchLike } from "../../modules/weather/WeatherManager";

vi.mock("../../utils/logger", () => {
  const log = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  return { default: log, createLogger: () => log };
});

describe("setupWebSocket", () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const fn of cleanups.splice(0).reverse()) await fn();
  });

  it("sends the current weather to a client as soon as it connects", async () => {
    const weather = new WeatherManager(
      { enabled: false, pollIntervalMs: 60_000, lat: 0, lon: 0, fetchTimeoutMs: 1000 },
      vi.fn<FetchLike>()
    );
    weather.setOverride({ condition: "rain" });

    const server = http.createServer();
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const { wss, broadcaster } = setupWebSocket(server, {
      onClientConnected: (ws, b) => b.sendTo(ws, "weather", weather.state()),
    });
    cleanups.push(
      () => new Promise<void>((resolve) => server.close(() => resolve())),
      () => new Promise<void>((resolve) => wss.close(() => resolve())),
      () => broadcaster.stop()
    );

    const port = (server.address() as AddressInfo).port;
    const client = new WebSocket(`ws://127.0.0.1:${port}`);
    cleanups.push(() => client.terminate());
    const first = await new Promise<{ type: string; data: unknown }>((resolve, reject) => {
      client.once("message", (raw) => resolve(JSON.parse(raw.toString())));
      client.once("error", reject);
    });

    expect(first.type).toBe("weather");
    expect(first.data).toEqual(weather.state());
  });
});
