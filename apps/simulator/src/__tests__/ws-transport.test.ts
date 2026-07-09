import { describe, it, expect, vi } from "vitest";
import type { WebSocket, WebSocketServer } from "ws";
import { selectBroadcastTransport } from "../modules/ws/selectTransport";
import { InProcessTransport } from "../modules/ws/InProcessTransport";
import { RedisPubSubTransport, type RedisPublisher } from "../modules/ws/RedisPubSubTransport";
import { ClientFanout } from "../modules/ws/ClientFanout";
import { decodeEnvelope } from "../modules/ws/wireEnvelope";
import type { VehicleDTO } from "../types";

vi.mock("../utils/logger", () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

// --- Mocks reused across suites ---

function createMockClient(readyState = 1, bufferedAmount = 0): MockWebSocket {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
  return {
    readyState,
    bufferedAmount,
    send: vi.fn(),
    OPEN: 1,
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      (listeners[event] ??= []).push(cb);
    }),
  };
}

interface MockWebSocket {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  OPEN: number;
  close: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  terminate: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

function createMockWSS(clients: MockWebSocket[] = []): {
  clients: Set<WebSocket>;
} {
  return { clients: new Set(clients) as unknown as Set<WebSocket> };
}

function makeVehicle(id: string, overrides: Partial<VehicleDTO> = {}): VehicleDTO {
  return {
    id,
    name: `Vehicle ${id}`,
    type: "car",
    position: [-1.286, 36.817],
    speed: 40,
    heading: 90,
    ...overrides,
  };
}

// --- Transport selection from config ---

describe("selectBroadcastTransport", () => {
  it("defaults to the in-process transport (WS_TRANSPORT=inprocess)", () => {
    const wss = createMockWSS();
    const transport = selectBroadcastTransport(
      wss as unknown as WebSocketServer,
      { pingIntervalMs: 0, pongTimeoutMs: 0 },
      { wsTransport: "inprocess", redisUrl: "", wsPubSubChannel: "ch" }
    );
    expect(transport).toBeInstanceOf(InProcessTransport);
  });

  it("selects the Redis transport when WS_TRANSPORT=redis", () => {
    const wss = createMockWSS();
    const transport = selectBroadcastTransport(
      wss as unknown as WebSocketServer,
      { pingIntervalMs: 0, pongTimeoutMs: 0 },
      {
        wsTransport: "redis",
        redisUrl: "redis://localhost:6379",
        wsPubSubChannel: "ch",
      }
    );
    expect(transport).toBeInstanceOf(RedisPubSubTransport);
  });
});

// --- RedisPubSubTransport publishes serialized envelopes (mocked ioredis) ---

describe("RedisPubSubTransport", () => {
  function createMockPublisher(): RedisPublisher & {
    publish: ReturnType<typeof vi.fn>;
    quit: ReturnType<typeof vi.fn>;
  } {
    return {
      publish: vi.fn().mockResolvedValue(1),
      quit: vi.fn().mockResolvedValue("OK"),
      on: vi.fn(),
    };
  }

  it("publishes a vehicles envelope to the configured channel (no real connection)", async () => {
    const pub = createMockPublisher();
    const transport = new RedisPubSubTransport({
      redisUrl: "redis://unused",
      channel: "moveet:test",
      createPublisher: () => pub,
    });

    transport.start();
    // start() resolves the publisher promise on the microtask queue.
    await Promise.resolve();
    await Promise.resolve();

    const vehicles = [makeVehicle("v1"), makeVehicle("v2", { speed: 12 })];
    transport.publishVehicleUpdates(vehicles);

    expect(pub.publish).toHaveBeenCalledTimes(1);
    const [channel, payload] = pub.publish.mock.calls[0] as [string, string];
    expect(channel).toBe("moveet:test");

    const decoded = decodeEnvelope(payload);
    expect(decoded?.kind).toBe("vehicles");
    if (decoded?.kind === "vehicles") {
      expect(decoded.vehicles.map((v) => v.id)).toEqual(["v1", "v2"]);
      expect(decoded.vehicles[1].speed).toBe(12);
    }

    transport.stop();
    expect(pub.quit).toHaveBeenCalledTimes(1);
  });

  it("publishes a non-vehicle message envelope", async () => {
    const pub = createMockPublisher();
    const transport = new RedisPubSubTransport({
      redisUrl: "redis://unused",
      channel: "moveet:test",
      createPublisher: () => pub,
    });
    transport.start();
    await Promise.resolve();
    await Promise.resolve();

    transport.publishMessage("status", {
      running: true,
      interval: 500,
      ready: true,
    });

    expect(pub.publish).toHaveBeenCalledTimes(1);
    const [, payload] = pub.publish.mock.calls[0] as [string, string];
    const decoded = decodeEnvelope(payload);
    expect(decoded?.kind).toBe("message");
    if (decoded?.kind === "message") {
      expect(decoded.type).toBe("status");
      expect(decoded.data).toMatchObject({ running: true });
    }

    transport.stop();
  });

  it("does no per-client work (clientCount/indexedVehicleCount stay 0)", () => {
    const transport = new RedisPubSubTransport({
      redisUrl: "redis://unused",
      channel: "ch",
      createPublisher: () => createMockPublisher(),
    });
    expect(transport.clientCount).toBe(0);
    expect(transport.indexedVehicleCount).toBe(0);
    // Per-socket / index methods are inert no-ops, must not throw.
    expect(() => transport.indexVehicle()).not.toThrow();
    expect(() => transport.removeVehicle()).not.toThrow();
    expect(() => transport.clearIndex()).not.toThrow();
  });

  it("drops publishes silently before the connection is established", () => {
    // Never resolve the publisher → publisher stays null.
    const transport = new RedisPubSubTransport({
      redisUrl: "redis://unused",
      channel: "ch",
      createPublisher: () => new Promise<RedisPublisher>(() => {}),
    });
    transport.start();
    expect(() => transport.publishVehicleUpdates([makeVehicle("v1")])).not.toThrow();
  });
});

// --- Gateway fan-out parity: ClientFanout behaves like the in-process path ---

describe("ClientFanout (shared gateway / in-process engine)", () => {
  it("delta-filters: an unchanged vehicle is not re-sent on a second fan-out", () => {
    const client = createMockClient();
    const wss = createMockWSS([client]);
    const fanout = new ClientFanout(wss as unknown as WebSocketServer, {
      pingIntervalMs: 0,
      pongTimeoutMs: 0,
    });

    const v = makeVehicle("v1", { position: [-1.286, 36.817] });
    fanout.indexVehicle(v.id, v.position[0], v.position[1]);
    fanout.fanoutVehicles([v]);
    expect(client.send).toHaveBeenCalledTimes(1);

    // Same position → filtered out.
    const v2 = makeVehicle("v1", { position: [-1.286, 36.817] });
    fanout.indexVehicle(v2.id, v2.position[0], v2.position[1]);
    fanout.fanoutVehicles([v2]);
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it("bbox-filters via the spatial index exactly like the in-process broadcaster", () => {
    const client = createMockClient();
    const wss = createMockWSS([client]);
    const fanout = new ClientFanout(wss as unknown as WebSocketServer, {
      pingIntervalMs: 0,
      pongTimeoutMs: 0,
    });
    fanout.setClientFilter(client as unknown as WebSocket, {
      bbox: { minLat: -1.3, maxLat: -1.2, minLng: 36.8, maxLng: 36.9 },
    });

    const inBox = makeVehicle("in", { position: [-1.25, 36.85] });
    const outBox = makeVehicle("out", { position: [5.0, 10.0] });
    for (const v of [inBox, outBox]) fanout.indexVehicle(v.id, v.position[0], v.position[1]);

    fanout.fanoutVehicles([inBox, outBox]);

    expect(client.send).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(client.send.mock.calls[0][0] as string);
    expect(parsed.type).toBe("vehicles");
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0].id).toBe("in");
  });

  it("routes a decoded vehicles envelope through the fan-out (gateway path)", () => {
    // Mirrors what ws-gateway does on each Redis message: decode → index → fan out.
    const client = createMockClient();
    const wss = createMockWSS([client]);
    const fanout = new ClientFanout(wss as unknown as WebSocketServer, {
      pingIntervalMs: 0,
      pongTimeoutMs: 0,
    });

    const payload = JSON.stringify({
      kind: "vehicles",
      vehicles: [makeVehicle("v1"), makeVehicle("v2")],
    });
    const envelope = decodeEnvelope(payload);
    expect(envelope?.kind).toBe("vehicles");
    if (envelope?.kind === "vehicles") {
      for (const v of envelope.vehicles) fanout.indexVehicle(v.id, v.position[0], v.position[1]);
      fanout.fanoutVehicles(envelope.vehicles);
    }

    expect(client.send).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(client.send.mock.calls[0][0] as string);
    expect(parsed.data.map((v: VehicleDTO) => v.id)).toEqual(["v1", "v2"]);
  });

  it("decodeEnvelope rejects malformed payloads", () => {
    expect(decodeEnvelope("not json")).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ kind: "bogus" }))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ kind: "vehicles" }))).toBeNull();
    expect(decodeEnvelope(JSON.stringify({ kind: "message", type: "status" }))).toBeNull();
  });

  it("broadcastRaw forwards a pre-serialized frame to every open client", () => {
    const open = createMockClient(1);
    const closed = createMockClient(3);
    const wss = createMockWSS([open, closed]);
    const fanout = new ClientFanout(wss as unknown as WebSocketServer, {
      pingIntervalMs: 0,
      pongTimeoutMs: 0,
    });

    fanout.broadcastRaw(JSON.stringify({ type: "status", data: { running: true } }));

    expect(open.send).toHaveBeenCalledTimes(1);
    expect(closed.send).not.toHaveBeenCalled();
  });
});
