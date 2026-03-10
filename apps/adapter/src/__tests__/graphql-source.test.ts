import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequest = vi.fn();

vi.mock("graphql-request", () => ({
  GraphQLClient: class MockGraphQLClient {
    constructor() {}
    request = mockRequest;
  },
  gql: (strings: TemplateStringsArray) => strings.join(""),
}));

import { GraphQLSource } from "../plugins/sources/graphql";

describe("GraphQLSource", () => {
  beforeEach(() => {
    mockRequest.mockClear();
  });

  it("has correct type and name", () => {
    const source = new GraphQLSource();
    expect(source.type).toBe("graphql");
    expect(source.name).toBe("GraphQL API");
  });

  it("requires url", async () => {
    const source = new GraphQLSource();
    await expect(source.connect({})).rejects.toThrow("GraphQL source requires url");
  });

  it("connects with url and token", async () => {
    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql", token: "abc123" });
    mockRequest.mockResolvedValueOnce({ __typename: "Query" });
    expect((await source.healthCheck()).healthy).toBe(true);
  });

  it("fetches and maps vehicles", async () => {
    mockRequest.mockResolvedValue({
      vehicles: {
        nodes: [
          {
            id: "v1",
            callsign: "Vehicle 1",
            isOnline: true,
            _currentShift: null,
            _trackingType: "FLARE_APP",
            vehicleTypeRef: { value: "ALS" },
            latitude: -1.3,
            longitude: 36.8,
          },
        ],
      },
    });

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
    expect(vehicles[0].name).toBe("Vehicle 1");
    expect(vehicles[0].position).toEqual([-1.3, 36.8]);
  });

  it("respects maxVehicles limit", async () => {
    mockRequest.mockResolvedValue({
      vehicles: {
        nodes: Array.from({ length: 50 }, (_, i) => ({
          id: `v${i}`,
          callsign: `V${i}`,
          latitude: -1.3,
          longitude: 36.8,
          isOnline: true,
          _currentShift: null,
          _trackingType: "FLARE_APP",
          vehicleTypeRef: { value: "ALS" },
        })),
      },
    });

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql", maxVehicles: 10 });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(10);
  });

  it("throws on query error instead of returning empty array", async () => {
    mockRequest.mockRejectedValue(new Error("Network error"));

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    await expect(source.getVehicles()).rejects.toThrow("Network error");
  });

  it("filters out vehicles with NaN coordinates", async () => {
    mockRequest.mockResolvedValue({
      vehicles: {
        nodes: [
          { id: "v1", callsign: "Good", latitude: -1.28, longitude: 36.8 },
          { id: "v2", callsign: "Bad", latitude: "not-a-number", longitude: 36.8 },
          { id: "v3", callsign: "Undefined", latitude: undefined, longitude: undefined },
        ],
      },
    });

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
  });

  it("throws on auth errors", async () => {
    mockRequest.mockRejectedValue(new Error("401 Unauthorized"));

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    await expect(source.getVehicles()).rejects.toThrow("401 Unauthorized");
  });

  it("throws on network errors", async () => {
    mockRequest.mockRejectedValue(new Error("ECONNREFUSED"));

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    await expect(source.getVehicles()).rejects.toThrow("ECONNREFUSED");
  });

  it("health check reflects connection state", async () => {
    const source = new GraphQLSource();
    expect((await source.healthCheck()).healthy).toBe(false);
    await source.connect({ url: "https://api.example.com/graphql" });
    mockRequest.mockResolvedValueOnce({ __typename: "Query" });
    expect((await source.healthCheck()).healthy).toBe(true);
    await source.disconnect();
    expect((await source.healthCheck()).healthy).toBe(false);
  });

  it("has config schema with required url", () => {
    const source = new GraphQLSource();
    expect(source.configSchema.length).toBeGreaterThan(0);
    const urlField = source.configSchema.find((f) => f.name === "url");
    expect(urlField).toBeDefined();
    expect(urlField!.required).toBe(true);
  });
});
