import { vi } from "vitest";

export function createMockClient() {
  return {
    connectWebSocket: vi.fn(),
    disconnect: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onVehicle: vi.fn(),
    onStatus: vi.fn(),
    onOptions: vi.fn(),
    onHeatzones: vi.fn(),
    onDirection: vi.fn(),
    onReset: vi.fn(),
    start: vi.fn().mockResolvedValue({ data: undefined }),
    stop: vi.fn().mockResolvedValue({ data: undefined }),
    reset: vi.fn().mockResolvedValue({ data: undefined }),
    direction: vi.fn().mockResolvedValue({ data: undefined }),
    getStatus: vi.fn().mockResolvedValue({ data: { running: false, interval: 1000 } }),
    getVehicles: vi.fn().mockResolvedValue({ data: [] }),
    getNetwork: vi.fn().mockResolvedValue({ data: { type: "FeatureCollection", features: [] } }),
    getRoads: vi.fn().mockResolvedValue({ data: [] }),
    getPois: vi.fn().mockResolvedValue({ data: [] }),
    findRoad: vi.fn().mockResolvedValue({ data: null }),
    findNode: vi.fn().mockResolvedValue({ data: null }),
    getOptions: vi.fn().mockResolvedValue({ data: null }),
    updateOptions: vi.fn().mockResolvedValue({ data: undefined }),
    setUseAdapter: vi.fn().mockResolvedValue({ data: [] }),
    getDirections: vi.fn().mockResolvedValue({ data: [] }),
    getHeatzones: vi.fn().mockResolvedValue({ data: [] }),
    makeHeatzones: vi.fn().mockResolvedValue({ data: undefined }),
    search: vi.fn().mockResolvedValue({ data: null }),
  };
}
