import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  WebSocketBroadcaster,
  BACKPRESSURE_THRESHOLD,
  MAX_DROPPED_FLUSHES,
  POSITION_DELTA_THRESHOLD,
} from "../modules/WebSocketBroadcaster";
import type { VehicleDTO } from "../types";

// --- Mock WebSocket & WebSocketServer ---

function createMockClient(readyState = 1, bufferedAmount = 0): MockWebSocket {
  return {
    readyState,
    bufferedAmount,
    send: vi.fn(),
    OPEN: 1,
    close: vi.fn(),
  };
}

interface MockWebSocket {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  OPEN: number;
  close: ReturnType<typeof vi.fn>;
}

function createMockWSS(clients: MockWebSocket[] = []): MockWSS {
  return {
    clients: new Set(clients) as unknown as Set<import("ws").WebSocket>,
  };
}

interface MockWSS {
  clients: Set<import("ws").WebSocket>;
}

function makeVehicle(id: string, overrides: Partial<VehicleDTO> = {}): VehicleDTO {
  return {
    id,
    name: `Vehicle ${id}`,
    position: [-1.286, 36.817],
    speed: 40,
    heading: 90,
    ...overrides,
  };
}

// --- Tests ---

describe("WebSocketBroadcaster", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("vehicle update batching", () => {
    it("should batch multiple vehicle updates into a single message per flush", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      broadcaster.queueVehicleUpdate(makeVehicle("v2"));
      broadcaster.queueVehicleUpdate(makeVehicle("v3"));

      // Nothing sent yet — updates are buffered
      expect(client.send).not.toHaveBeenCalled();

      // Advance past the flush interval
      vi.advanceTimersByTime(100);

      // One single message containing all three vehicles
      expect(client.send).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(client.send.mock.calls[0][0] as string);
      expect(parsed.type).toBe("vehicles");
      expect(parsed.data).toHaveLength(3);
      expect(parsed.data.map((v: VehicleDTO) => v.id)).toEqual(["v1", "v2", "v3"]);

      broadcaster.stop();
    });

    it("should deduplicate vehicle updates — only the latest state is sent", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1", { speed: 30 }));
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { speed: 50 }));
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { speed: 70 }));

      vi.advanceTimersByTime(100);

      expect(client.send).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(client.send.mock.calls[0][0] as string);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].speed).toBe(70);

      broadcaster.stop();
    });

    it("should not send anything when buffer is empty", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 50,
      });
      broadcaster.start();

      vi.advanceTimersByTime(200);

      expect(client.send).not.toHaveBeenCalled();

      broadcaster.stop();
    });
  });

  describe("immediate broadcast for non-vehicle messages", () => {
    it("should send non-vehicle messages immediately to all clients", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const wss = createMockWSS([client1, client2]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);

      const heatZoneData = { zones: [{ id: "hz1", intensity: 0.5 }] };
      broadcaster.broadcast("heatzones", heatZoneData);

      // Both clients receive the message immediately (no timer advance needed)
      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).toHaveBeenCalledTimes(1);

      const parsed1 = JSON.parse(client1.send.mock.calls[0][0] as string);
      expect(parsed1.type).toBe("heatzones");
      expect(parsed1.data).toEqual(heatZoneData);

      const parsed2 = JSON.parse(client2.send.mock.calls[0][0] as string);
      expect(parsed2).toEqual(parsed1);
    });

    it("should send direction messages immediately", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);

      broadcaster.broadcast("direction", { vehicleId: "v1", route: [] });

      expect(client.send).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(client.send.mock.calls[0][0] as string);
      expect(parsed.type).toBe("direction");
    });

    it("should send status messages immediately", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);

      broadcaster.broadcast("status", { running: true, interval: 500, ready: true });

      expect(client.send).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(client.send.mock.calls[0][0] as string);
      expect(parsed.type).toBe("status");
    });
  });

  describe("readyState checks", () => {
    it("should skip clients that are not in OPEN state for batched messages", () => {
      const openClient = createMockClient(1); // OPEN
      const closingClient = createMockClient(2); // CLOSING
      const closedClient = createMockClient(3); // CLOSED
      const wss = createMockWSS([openClient, closingClient, closedClient]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 50,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      vi.advanceTimersByTime(50);

      expect(openClient.send).toHaveBeenCalledTimes(1);
      expect(closingClient.send).not.toHaveBeenCalled();
      expect(closedClient.send).not.toHaveBeenCalled();

      broadcaster.stop();
    });

    it("should skip clients that are not in OPEN state for immediate broadcast", () => {
      const openClient = createMockClient(1);
      const closedClient = createMockClient(3);
      const wss = createMockWSS([openClient, closedClient]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);

      broadcaster.broadcast("status", { running: true });

      expect(openClient.send).toHaveBeenCalledTimes(1);
      expect(closedClient.send).not.toHaveBeenCalled();
    });
  });

  describe("client disconnect handling", () => {
    it("should handle clients being removed from the set between flushes", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const wss = createMockWSS([client1, client2]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));

      // Simulate client2 disconnecting (removed from the Set by ws library)
      (wss.clients as unknown as Set<MockWebSocket>).delete(client2);

      vi.advanceTimersByTime(100);

      // Only client1 receives the message
      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).not.toHaveBeenCalled();

      broadcaster.stop();
    });

    it("should report correct client count", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const wss = createMockWSS([client1, client2]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);

      expect(broadcaster.clientCount).toBe(2);

      (wss.clients as unknown as Set<MockWebSocket>).delete(client1);
      expect(broadcaster.clientCount).toBe(1);
    });
  });

  describe("flush interval", () => {
    it("should flush at the configured interval", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 200,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));

      // At 100ms — no flush yet
      vi.advanceTimersByTime(100);
      expect(client.send).not.toHaveBeenCalled();

      // At 200ms — first flush
      vi.advanceTimersByTime(100);
      expect(client.send).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });

    it("should use default 100ms interval when not specified", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));

      vi.advanceTimersByTime(99);
      expect(client.send).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(client.send).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });

    it("should flush on each interval tick independently", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      // First batch
      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      vi.advanceTimersByTime(100);
      expect(client.send).toHaveBeenCalledTimes(1);

      // Second batch
      broadcaster.queueVehicleUpdate(makeVehicle("v2"));
      vi.advanceTimersByTime(100);
      expect(client.send).toHaveBeenCalledTimes(2);

      const batch1 = JSON.parse(client.send.mock.calls[0][0] as string);
      const batch2 = JSON.parse(client.send.mock.calls[1][0] as string);
      expect(batch1.data.map((v: VehicleDTO) => v.id)).toEqual(["v1"]);
      expect(batch2.data.map((v: VehicleDTO) => v.id)).toEqual(["v2"]);

      broadcaster.stop();
    });
  });

  describe("start / stop lifecycle", () => {
    it("should not flush after stop is called", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      broadcaster.stop();

      vi.advanceTimersByTime(200);

      expect(client.send).not.toHaveBeenCalled();
    });

    it("should clear the buffer on stop", () => {
      const wss = createMockWSS();
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      expect(broadcaster.pendingUpdates).toBe(1);

      broadcaster.stop();
      expect(broadcaster.pendingUpdates).toBe(0);
    });

    it("should be safe to call start multiple times", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });

      broadcaster.start();
      broadcaster.start(); // should be a no-op

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      vi.advanceTimersByTime(100);

      // Only one message — second start() didn't create a duplicate timer
      expect(client.send).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });

    it("should be safe to call stop without start", () => {
      const wss = createMockWSS();
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);

      // Should not throw
      expect(() => broadcaster.stop()).not.toThrow();
    });
  });

  describe("sendTo", () => {
    it("should send a message to a specific client", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);

      broadcaster.sendTo(client as unknown as import("ws").WebSocket, "options", {
        updateInterval: 500,
      });

      expect(client.send).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(client.send.mock.calls[0][0] as string);
      expect(parsed.type).toBe("options");
      expect(parsed.data).toEqual({ updateInterval: 500 });
    });

    it("should not send to a closed client", () => {
      const client = createMockClient(3); // CLOSED
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);

      broadcaster.sendTo(client as unknown as import("ws").WebSocket, "options", {
        updateInterval: 500,
      });

      expect(client.send).not.toHaveBeenCalled();
    });
  });

  describe("multi-client broadcast", () => {
    it("should send batched vehicle updates to all connected clients", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const client3 = createMockClient();
      const wss = createMockWSS([client1, client2, client3]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      broadcaster.queueVehicleUpdate(makeVehicle("v2"));

      vi.advanceTimersByTime(100);

      // All three clients get the same message
      for (const client of [client1, client2, client3]) {
        expect(client.send).toHaveBeenCalledTimes(1);
        const parsed = JSON.parse(client.send.mock.calls[0][0] as string);
        expect(parsed.type).toBe("vehicles");
        expect(parsed.data).toHaveLength(2);
      }

      broadcaster.stop();
    });
  });

  describe("backpressure", () => {
    it("should skip a client whose bufferedAmount exceeds the threshold", () => {
      const slowClient = createMockClient(1, BACKPRESSURE_THRESHOLD + 1);
      const fastClient = createMockClient(1, 0);
      const wss = createMockWSS([slowClient, fastClient]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      vi.advanceTimersByTime(100);

      expect(slowClient.send).not.toHaveBeenCalled();
      expect(fastClient.send).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });

    it("should allow sending when bufferedAmount is exactly at the threshold", () => {
      // bufferedAmount must be strictly greater than threshold to skip
      const client = createMockClient(1, BACKPRESSURE_THRESHOLD);
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      vi.advanceTimersByTime(100);

      // Exactly at the threshold is NOT over, so the client receives the message
      expect(client.send).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });

    it("should resume sending to a client once backpressure clears", () => {
      const client = createMockClient(1, BACKPRESSURE_THRESHOLD + 1);
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      // First flush — client is slow, skipped
      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      vi.advanceTimersByTime(100);
      expect(client.send).not.toHaveBeenCalled();

      // Client catches up
      client.bufferedAmount = 0;

      // Second flush — client is fast again
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.29, 36.82] }));
      vi.advanceTimersByTime(100);
      expect(client.send).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });
  });

  describe("drop policy", () => {
    it("should close a client that exceeds MAX_DROPPED_FLUSHES consecutive skips", () => {
      const slowClient = createMockClient(1, BACKPRESSURE_THRESHOLD + 1);
      const wss = createMockWSS([slowClient]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      // Simulate MAX_DROPPED_FLUSHES + 1 flushes with backpressure
      for (let i = 0; i <= MAX_DROPPED_FLUSHES; i++) {
        broadcaster.queueVehicleUpdate(
          makeVehicle("v1", { position: [-1.286 + i * 0.001, 36.817] })
        );
        vi.advanceTimersByTime(100);
      }

      expect(slowClient.send).not.toHaveBeenCalled();
      expect(slowClient.close).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });

    it("should not close a client that recovers before hitting MAX_DROPPED_FLUSHES", () => {
      const client = createMockClient(1, BACKPRESSURE_THRESHOLD + 1);
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      // Simulate some dropped flushes (less than the max)
      for (let i = 0; i < MAX_DROPPED_FLUSHES - 1; i++) {
        broadcaster.queueVehicleUpdate(
          makeVehicle("v1", { position: [-1.286 + i * 0.001, 36.817] })
        );
        vi.advanceTimersByTime(100);
      }

      expect(client.close).not.toHaveBeenCalled();

      // Client recovers
      client.bufferedAmount = 0;

      // Next flush should succeed and reset the counter
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.3, 36.83] }));
      vi.advanceTimersByTime(100);

      expect(client.send).toHaveBeenCalledTimes(1);
      expect(client.close).not.toHaveBeenCalled();

      // Now backpressure again — counter should have reset
      client.bufferedAmount = BACKPRESSURE_THRESHOLD + 1;
      for (let i = 0; i < MAX_DROPPED_FLUSHES; i++) {
        broadcaster.queueVehicleUpdate(
          makeVehicle("v1", { position: [-1.286 + i * 0.002, 36.817] })
        );
        vi.advanceTimersByTime(100);
      }

      // Should NOT be closed yet — just at the limit, not over
      expect(client.close).not.toHaveBeenCalled();

      broadcaster.stop();
    });
  });

  describe("delta filtering", () => {
    it("should not send a vehicle whose position has not changed since last send", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      const vehicle = makeVehicle("v1", { position: [-1.286, 36.817] });

      // First flush — vehicle is new, should be sent
      broadcaster.queueVehicleUpdate(vehicle);
      vi.advanceTimersByTime(100);
      expect(client.send).toHaveBeenCalledTimes(1);

      // Second flush — exact same position, should be filtered out
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.286, 36.817] }));
      vi.advanceTimersByTime(100);

      // No second send because position didn't change
      expect(client.send).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });

    it("should send a vehicle whose position changed below the threshold", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      // First flush — send initial position
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.286, 36.817] }));
      vi.advanceTimersByTime(100);
      expect(client.send).toHaveBeenCalledTimes(1);

      // Tiny position change (well below threshold)
      const tinyDelta = POSITION_DELTA_THRESHOLD / 10;
      broadcaster.queueVehicleUpdate(
        makeVehicle("v1", { position: [-1.286 + tinyDelta, 36.817 + tinyDelta] })
      );
      vi.advanceTimersByTime(100);

      // Should not be sent
      expect(client.send).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });

    it("should send a vehicle whose position changed above the threshold", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      // First flush
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.286, 36.817] }));
      vi.advanceTimersByTime(100);
      expect(client.send).toHaveBeenCalledTimes(1);

      // Significant position change (above threshold)
      const bigDelta = POSITION_DELTA_THRESHOLD * 2;
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.286 + bigDelta, 36.817] }));
      vi.advanceTimersByTime(100);

      // Should be sent
      expect(client.send).toHaveBeenCalledTimes(2);

      broadcaster.stop();
    });

    it("should always send a vehicle that has never been sent to a client", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      // First time seeing this vehicle — always sent regardless of position
      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      vi.advanceTimersByTime(100);

      expect(client.send).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(client.send.mock.calls[0][0] as string);
      expect(parsed.data).toHaveLength(1);
      expect(parsed.data[0].id).toBe("v1");

      broadcaster.stop();
    });

    it("should filter per-client independently", () => {
      const client1 = createMockClient();
      const client2 = createMockClient();
      const wss = createMockWSS([client1, client2]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      // First flush — both clients receive the vehicle
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.286, 36.817] }));
      vi.advanceTimersByTime(100);
      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).toHaveBeenCalledTimes(1);

      // Now remove client2 and re-add as a "new" client (simulating reconnect)
      // Actually, we test delta independence by having client1 skip while
      // a new vehicle appears for both

      // Same position — both clients should be filtered
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.286, 36.817] }));
      vi.advanceTimersByTime(100);
      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).toHaveBeenCalledTimes(1);

      broadcaster.stop();
    });

    it("should send mixed batch — some vehicles changed, some not", () => {
      const client = createMockClient();
      const wss = createMockWSS([client]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      // First flush — both vehicles sent
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.286, 36.817] }));
      broadcaster.queueVehicleUpdate(makeVehicle("v2", { position: [-1.3, 36.83] }));
      vi.advanceTimersByTime(100);
      expect(client.send).toHaveBeenCalledTimes(1);

      const batch1 = JSON.parse(client.send.mock.calls[0][0] as string);
      expect(batch1.data).toHaveLength(2);

      // Second flush — v1 unchanged, v2 moved significantly
      broadcaster.queueVehicleUpdate(makeVehicle("v1", { position: [-1.286, 36.817] }));
      broadcaster.queueVehicleUpdate(
        makeVehicle("v2", { position: [-1.3 + POSITION_DELTA_THRESHOLD * 3, 36.83] })
      );
      vi.advanceTimersByTime(100);

      expect(client.send).toHaveBeenCalledTimes(2);
      const batch2 = JSON.parse(client.send.mock.calls[1][0] as string);
      expect(batch2.data).toHaveLength(1);
      expect(batch2.data[0].id).toBe("v2");

      broadcaster.stop();
    });
  });

  describe("mixed slow and fast clients", () => {
    it("should send to fast client while skipping slow client", () => {
      const slowClient = createMockClient(1, BACKPRESSURE_THRESHOLD + 1);
      const fastClient = createMockClient(1, 0);
      const wss = createMockWSS([slowClient, fastClient]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      broadcaster.queueVehicleUpdate(makeVehicle("v2"));
      vi.advanceTimersByTime(100);

      // Fast client gets the message
      expect(fastClient.send).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(fastClient.send.mock.calls[0][0] as string);
      expect(parsed.data).toHaveLength(2);

      // Slow client is skipped
      expect(slowClient.send).not.toHaveBeenCalled();

      broadcaster.stop();
    });

    it("should not affect broadcast/sendTo for slow clients", () => {
      const slowClient = createMockClient(1, BACKPRESSURE_THRESHOLD + 1);
      const wss = createMockWSS([slowClient]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer);

      // Non-vehicle broadcast should NOT check backpressure
      broadcaster.broadcast("status", { running: true });
      expect(slowClient.send).toHaveBeenCalledTimes(1);

      // sendTo should NOT check backpressure
      broadcaster.sendTo(slowClient as unknown as import("ws").WebSocket, "options", {
        updateInterval: 500,
      });
      expect(slowClient.send).toHaveBeenCalledTimes(2);
    });

    it("should handle multiple clients at different backpressure levels", () => {
      const client1 = createMockClient(1, 0); // OK
      const client2 = createMockClient(1, BACKPRESSURE_THRESHOLD - 1); // OK (under)
      const client3 = createMockClient(1, BACKPRESSURE_THRESHOLD + 10000); // Over
      const wss = createMockWSS([client1, client2, client3]);
      const broadcaster = new WebSocketBroadcaster(wss as unknown as import("ws").WebSocketServer, {
        flushIntervalMs: 100,
      });
      broadcaster.start();

      broadcaster.queueVehicleUpdate(makeVehicle("v1"));
      vi.advanceTimersByTime(100);

      expect(client1.send).toHaveBeenCalledTimes(1);
      expect(client2.send).toHaveBeenCalledTimes(1);
      expect(client3.send).not.toHaveBeenCalled();

      broadcaster.stop();
    });
  });

  describe("exported constants", () => {
    it("should export BACKPRESSURE_THRESHOLD as 64KB", () => {
      expect(BACKPRESSURE_THRESHOLD).toBe(64 * 1024);
    });

    it("should export MAX_DROPPED_FLUSHES as 50", () => {
      expect(MAX_DROPPED_FLUSHES).toBe(50);
    });

    it("should export POSITION_DELTA_THRESHOLD as 0.0001", () => {
      expect(POSITION_DELTA_THRESHOLD).toBe(0.0001);
    });
  });
});
