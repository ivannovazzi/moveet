import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIncidents } from "./useIncidents";
import client from "@/utils/client";
import type { IncidentDTO } from "@/types";

vi.mock("@/utils/client", () => ({
  default: {
    getIncidents: vi.fn(),
    onIncidentCreated: vi.fn(),
    onIncidentCleared: vi.fn(),
    createRandomIncident: vi.fn(),
    removeIncident: vi.fn(),
    createIncidentAtPosition: vi.fn(),
  },
}));

function createIncident(overrides: Partial<IncidentDTO> = {}): IncidentDTO {
  return {
    id: "inc-1",
    edgeIds: ["edge-1"],
    type: "accident",
    severity: 3,
    speedFactor: 0.5,
    startTime: Date.now(),
    duration: 60000,
    expiresAt: Date.now() + 60000,
    autoClears: true,
    position: [-1.29, 36.82],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(client.getIncidents).mockResolvedValue({ data: undefined });
  vi.mocked(client.onIncidentCreated).mockImplementation(() => {});
  vi.mocked(client.onIncidentCleared).mockImplementation(() => {});
  vi.mocked(client.createRandomIncident).mockResolvedValue({ data: undefined });
  vi.mocked(client.removeIncident).mockResolvedValue({ data: undefined });
  vi.mocked(client.createIncidentAtPosition).mockResolvedValue({ data: undefined });
});

describe("useIncidents", () => {
  it("initializes with empty incidents array", () => {
    const { result } = renderHook(() => useIncidents());
    expect(result.current.incidents).toEqual([]);
  });

  it("fetches incidents on mount and populates state", async () => {
    const inc1 = createIncident({ id: "inc-1" });
    const inc2 = createIncident({ id: "inc-2", type: "closure" });

    vi.mocked(client.getIncidents).mockResolvedValue({ data: [inc1, inc2] });

    const { result } = renderHook(() => useIncidents());

    await vi.waitFor(() => {
      expect(result.current.incidents).toHaveLength(2);
    });

    expect(result.current.incidents).toEqual([inc1, inc2]);
  });

  it("handles fetch returning no data gracefully", async () => {
    vi.mocked(client.getIncidents).mockResolvedValue({ data: undefined });

    const { result } = renderHook(() => useIncidents());

    await vi.waitFor(() => {
      expect(client.getIncidents).toHaveBeenCalledOnce();
    });

    expect(result.current.incidents).toEqual([]);
  });

  it("adds incident via WS onIncidentCreated callback", async () => {
    const { result } = renderHook(() => useIncidents());

    const onCreatedMock = vi.mocked(client.onIncidentCreated);
    expect(onCreatedMock).toHaveBeenCalledOnce();

    const handler = onCreatedMock.mock.calls[0][0];
    const wsIncident = createIncident({ id: "ws-inc-1" });

    act(() => {
      handler(wsIncident);
    });

    expect(result.current.incidents).toHaveLength(1);
    expect(result.current.incidents[0].id).toBe("ws-inc-1");
  });

  it("removes incident via WS onIncidentCleared callback", async () => {
    const inc1 = createIncident({ id: "inc-1" });
    const inc2 = createIncident({ id: "inc-2" });

    vi.mocked(client.getIncidents).mockResolvedValue({ data: [inc1, inc2] });

    const { result } = renderHook(() => useIncidents());

    await vi.waitFor(() => {
      expect(result.current.incidents).toHaveLength(2);
    });

    const onClearedMock = vi.mocked(client.onIncidentCleared);
    const handler = onClearedMock.mock.calls[0][0];

    act(() => {
      handler({ id: "inc-1" });
    });

    expect(result.current.incidents).toHaveLength(1);
    expect(result.current.incidents[0].id).toBe("inc-2");
  });

  it("createRandom calls client.createRandomIncident", async () => {
    const { result } = renderHook(() => useIncidents());

    await act(async () => {
      await result.current.createRandom();
    });

    expect(client.createRandomIncident).toHaveBeenCalledOnce();
  });

  it("remove calls client.removeIncident with the id", async () => {
    const { result } = renderHook(() => useIncidents());

    await act(async () => {
      await result.current.remove("inc-42");
    });

    expect(client.removeIncident).toHaveBeenCalledWith("inc-42");
  });

  it("createAtPosition calls client.createIncidentAtPosition with correct args", async () => {
    const { result } = renderHook(() => useIncidents());

    await act(async () => {
      await result.current.createAtPosition(-1.29, 36.82, "construction");
    });

    expect(client.createIncidentAtPosition).toHaveBeenCalledWith(-1.29, 36.82, "construction");
  });

  it("accumulates multiple WS-created incidents", () => {
    const { result } = renderHook(() => useIncidents());

    const handler = vi.mocked(client.onIncidentCreated).mock.calls[0][0];
    const inc1 = createIncident({ id: "ws-1" });
    const inc2 = createIncident({ id: "ws-2" });

    act(() => {
      handler(inc1);
    });
    act(() => {
      handler(inc2);
    });

    expect(result.current.incidents).toHaveLength(2);
    expect(result.current.incidents.map((i) => i.id)).toEqual(["ws-1", "ws-2"]);
  });
});

describe("useIncidents error handling", () => {
  it("createRandom sets error on API error", async () => {
    vi.mocked(client.createRandomIncident).mockResolvedValue({ error: "No edges available" });

    const { result } = renderHook(() => useIncidents());

    await act(async () => {
      await result.current.createRandom();
    });

    expect(result.current.error).toBe("No edges available");
  });

  it("createRandom sets error on network exception", async () => {
    vi.mocked(client.createRandomIncident).mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useIncidents());

    await act(async () => {
      await result.current.createRandom();
    });

    expect(result.current.error).toBe("Network error");
  });

  it("remove sets error on failure", async () => {
    vi.mocked(client.removeIncident).mockResolvedValue({ error: "Incident not found" });

    const { result } = renderHook(() => useIncidents());

    await act(async () => {
      await result.current.remove("nonexistent");
    });

    expect(result.current.error).toBe("Incident not found");
  });

  it("createAtPosition sets error on failure", async () => {
    vi.mocked(client.createIncidentAtPosition).mockResolvedValue({
      error: "Invalid coordinates",
    });

    const { result } = renderHook(() => useIncidents());

    await act(async () => {
      await result.current.createAtPosition(-1.29, 36.82, "accident");
    });

    expect(result.current.error).toBe("Invalid coordinates");
  });

  it("error clears on next successful operation", async () => {
    vi.mocked(client.createRandomIncident).mockResolvedValue({ error: "Some error" });

    const { result } = renderHook(() => useIncidents());

    await act(async () => {
      await result.current.createRandom();
    });
    expect(result.current.error).toBe("Some error");

    vi.mocked(client.createRandomIncident).mockResolvedValue({ data: undefined });

    await act(async () => {
      await result.current.createRandom();
    });
    expect(result.current.error).toBeNull();
  });
});
