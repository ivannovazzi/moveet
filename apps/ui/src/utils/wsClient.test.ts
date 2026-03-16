import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketClient } from "./wsClient";
import type { ConnectionStateInfo } from "./wsClient";

// Minimal mock WebSocket that lets us trigger lifecycle events
class MockWebSocket {
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((evt: { data: string }) => void) | null = null;
  onerror: ((err: unknown) => void) | null = null;

  close() {
    // Simulate the browser calling onclose asynchronously
    setTimeout(() => this.onclose?.(), 0);
  }
}

let mockInstances: MockWebSocket[] = [];

function createClient() {
  return new WebSocketClient("ws://localhost:5010", {
    autoReconnect: true,
    logReconnects: false,
  });
}

beforeEach(() => {
  mockInstances = [];
  vi.useFakeTimers();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = class extends MockWebSocket {
    constructor(_url: string) {
      super();
      mockInstances.push(this);
    }
  };
});

afterEach(() => {
  vi.useRealTimers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).WebSocket;
});

describe("WebSocketClient", () => {
  it("manual disconnect() does NOT trigger auto-reconnect", () => {
    const client = createClient();
    client.connect();

    // Simulate server accepting the connection
    const ws = mockInstances[0];
    ws.onopen?.();

    // Now manually disconnect
    client.disconnect();

    // The close() call schedules onclose via setTimeout(0)
    // Advance timers to fire the onclose handler
    vi.advanceTimersByTime(0);

    // No new WebSocket should have been created (only the original one)
    expect(mockInstances).toHaveLength(1);

    // Advance well past the initial reconnect delay to be sure
    vi.advanceTimersByTime(60_000);
    expect(mockInstances).toHaveLength(1);
  });

  it("unexpected close DOES trigger auto-reconnect", () => {
    const client = createClient();
    client.connect();

    const ws = mockInstances[0];
    ws.onopen?.();

    // Simulate an unexpected close (server drops connection)
    ws.onclose?.();

    // Initial backoff is 1000ms; advance past it
    vi.advanceTimersByTime(1_000);

    // A second WebSocket instance should have been created for the reconnect
    expect(mockInstances).toHaveLength(2);
  });

  it("connect() after manual disconnect works normally", () => {
    const client = createClient();
    client.connect();

    const ws1 = mockInstances[0];
    ws1.onopen?.();

    // Manually disconnect
    client.disconnect();
    vi.advanceTimersByTime(0); // flush onclose

    expect(mockInstances).toHaveLength(1);

    // Re-connect
    client.connect();
    expect(mockInstances).toHaveLength(2);

    const ws2 = mockInstances[1];
    ws2.onopen?.();

    // Simulate an unexpected close on the new connection
    ws2.onclose?.();

    // Should auto-reconnect since this was not a manual close
    vi.advanceTimersByTime(1_000);
    expect(mockInstances).toHaveLength(3);
  });

  it("reconnect attempt counter is reset on manual close", () => {
    const client = createClient();
    client.connect();

    const ws = mockInstances[0];
    ws.onopen?.();

    // Simulate several unexpected closes to bump the attempt counter
    ws.onclose?.();
    vi.advanceTimersByTime(1_000); // reconnect attempt 1
    const ws2 = mockInstances[1];
    ws2.onclose?.();
    vi.advanceTimersByTime(2_000); // reconnect attempt 2
    const ws3 = mockInstances[2];
    ws3.onopen?.();

    // Now manually disconnect
    client.disconnect();
    vi.advanceTimersByTime(0);

    // Re-connect and verify reconnect works from attempt 0
    client.connect();
    const ws4 = mockInstances[3];
    ws4.onopen?.();

    // Unexpected close should still reconnect (counter was reset)
    ws4.onclose?.();
    vi.advanceTimersByTime(1_000); // delay should be 1000ms (attempt 0), not escalated
    expect(mockInstances).toHaveLength(5);
  });
});

describe("WebSocketClient connection state", () => {
  it("starts in disconnected state", () => {
    const client = createClient();
    expect(client.connectionState).toBe("disconnected");
  });

  it("transitions to connected on successful open", () => {
    const client = createClient();
    const states: ConnectionStateInfo[] = [];
    client.onConnectionStateChange((info) => states.push({ ...info }));

    client.connect();
    mockInstances[0].onopen?.();

    expect(client.connectionState).toBe("connected");
    expect(states).toHaveLength(1);
    expect(states[0]).toEqual({ state: "connected", attempt: 0, maxAttempts: 10 });
  });

  it("transitions to reconnecting on unexpected close", () => {
    const client = createClient();
    const states: ConnectionStateInfo[] = [];
    client.onConnectionStateChange((info) => states.push({ ...info }));

    client.connect();
    mockInstances[0].onopen?.();
    mockInstances[0].onclose?.();

    expect(client.connectionState).toBe("reconnecting");
    expect(states).toHaveLength(2);
    expect(states[1]).toEqual({ state: "reconnecting", attempt: 0, maxAttempts: 10 });
  });

  it("transitions to disconnected on manual disconnect", () => {
    const client = createClient();
    const states: ConnectionStateInfo[] = [];
    client.onConnectionStateChange((info) => states.push({ ...info }));

    client.connect();
    mockInstances[0].onopen?.();
    client.disconnect();

    const lastState = states[states.length - 1];
    expect(lastState.state).toBe("disconnected");
    expect(client.connectionState).toBe("disconnected");
  });

  it("transitions to disconnected after max reconnect attempts exhausted", () => {
    const maxAttempts = 3;
    const client = new WebSocketClient("ws://localhost:5010", {
      autoReconnect: true,
      logReconnects: false,
      maxReconnectAttempts: maxAttempts,
    });
    const states: ConnectionStateInfo[] = [];
    client.onConnectionStateChange((info) => states.push({ ...info }));

    client.connect();
    mockInstances[0].onopen?.();

    // Exhaust all reconnect attempts
    for (let i = 0; i < maxAttempts; i++) {
      const ws = mockInstances[mockInstances.length - 1];
      ws.onclose?.();
      // Advance past the backoff delay to trigger reconnect
      vi.advanceTimersByTime(30_000);
    }

    // One more close after all attempts used
    const lastWs = mockInstances[mockInstances.length - 1];
    lastWs.onclose?.();

    expect(client.connectionState).toBe("disconnected");
    const lastState = states[states.length - 1];
    expect(lastState.state).toBe("disconnected");
  });

  it("tracks reconnection attempt number in state info", () => {
    const client = createClient();
    const states: ConnectionStateInfo[] = [];
    client.onConnectionStateChange((info) => states.push({ ...info }));

    client.connect();
    mockInstances[0].onopen?.();

    // First unexpected close — attempt 0
    mockInstances[0].onclose?.();
    vi.advanceTimersByTime(1_000); // triggers reconnect, reconnectAttempts becomes 1

    // Second unexpected close — attempt 1
    mockInstances[1].onclose?.();

    const reconnectingStates = states.filter((s) => s.state === "reconnecting");
    expect(reconnectingStates[0].attempt).toBe(0);
    expect(reconnectingStates[1].attempt).toBe(1);
  });

  it("unsubscribes listener when calling returned cleanup function", () => {
    const client = createClient();
    const states: ConnectionStateInfo[] = [];
    const unsubscribe = client.onConnectionStateChange((info) => states.push({ ...info }));

    client.connect();
    mockInstances[0].onopen?.();
    expect(states).toHaveLength(1);

    unsubscribe();

    // This should NOT trigger the listener
    client.disconnect();
    expect(states).toHaveLength(1);
  });

  it("transitions to disconnected when autoReconnect is false", () => {
    const client = new WebSocketClient("ws://localhost:5010", {
      autoReconnect: false,
      logReconnects: false,
    });
    const states: ConnectionStateInfo[] = [];
    client.onConnectionStateChange((info) => states.push({ ...info }));

    client.connect();
    mockInstances[0].onopen?.();
    mockInstances[0].onclose?.();

    expect(client.connectionState).toBe("disconnected");
    expect(states[states.length - 1].state).toBe("disconnected");
  });

  it("returns to connected after successful reconnect", () => {
    const client = createClient();
    const states: ConnectionStateInfo[] = [];
    client.onConnectionStateChange((info) => states.push({ ...info }));

    client.connect();
    mockInstances[0].onopen?.();

    // Unexpected close
    mockInstances[0].onclose?.();
    expect(client.connectionState).toBe("reconnecting");

    // Advance to trigger reconnect
    vi.advanceTimersByTime(1_000);

    // Reconnect succeeds
    mockInstances[1].onopen?.();
    expect(client.connectionState).toBe("connected");

    const stateSequence = states.map((s) => s.state);
    expect(stateSequence).toEqual(["connected", "reconnecting", "connected"]);
  });
});
