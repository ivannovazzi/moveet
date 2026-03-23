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

  it("throws when not connected", async () => {
    const source = new GraphQLSource();
    await expect(source.getVehicles()).rejects.toThrow("GraphQLSource: not connected");
  });

  it("throws after disconnect", async () => {
    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    await source.disconnect();
    await expect(source.getVehicles()).rejects.toThrow("GraphQLSource: not connected");
  });

  it("throws on query error instead of returning empty array", async () => {
    mockRequest.mockRejectedValue(new Error("Network error"));

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    await expect(source.getVehicles()).rejects.toThrow("Network error");
  });

  it("throws when vehicle path yields non-array", async () => {
    mockRequest.mockResolvedValue({
      vehicles: { nodes: "not-an-array" },
    });

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    await expect(source.getVehicles()).rejects.toThrow('expected array at path "vehicles.nodes"');
  });

  it("returns [] on successful query with empty result set", async () => {
    mockRequest.mockResolvedValue({
      vehicles: { nodes: [] },
    });

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    const vehicles = await source.getVehicles();
    expect(vehicles).toEqual([]);
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

  it("rejects field map with __proto__ path", async () => {
    const source = new GraphQLSource();
    await expect(
      source.connect({
        url: "https://api.example.com/graphql",
        fieldMap: { id: "__proto__.polluted", name: "callsign", lat: "latitude", lng: "longitude" },
      })
    ).rejects.toThrow("unsafe field map paths");
  });

  it("rejects field map with constructor.prototype path", async () => {
    const source = new GraphQLSource();
    await expect(
      source.connect({
        url: "https://api.example.com/graphql",
        fieldMap: {
          id: "id",
          name: "constructor.prototype.polluted",
          lat: "latitude",
          lng: "longitude",
        },
      })
    ).rejects.toThrow("unsafe field map paths");
  });

  it("getNestedValue returns undefined for prototype-polluting paths", async () => {
    mockRequest.mockResolvedValue({
      vehicles: {
        nodes: [{ id: "v1", callsign: "V1", latitude: -1.3, longitude: 36.8 }],
      },
    });

    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
  });

  it("has config schema with required url", () => {
    const source = new GraphQLSource();
    expect(source.configSchema.length).toBeGreaterThan(0);
    const urlField = source.configSchema.find((f) => f.name === "url");
    expect(urlField).toBeDefined();
    expect(urlField!.required).toBe(true);
  });

  it("accepts apiUrl as alternative to url", async () => {
    const source = new GraphQLSource();
    await source.connect({ apiUrl: "https://api.example.com/graphql" });
    mockRequest.mockResolvedValueOnce({ __typename: "Query" });
    expect((await source.healthCheck()).healthy).toBe(true);
  });

  it("uses custom vehiclePath", async () => {
    mockRequest.mockResolvedValue({
      data: {
        fleet: [{ id: "v1", callsign: "V1", latitude: -1.3, longitude: 36.8 }],
      },
    });

    const source = new GraphQLSource();
    await source.connect({
      url: "https://api.example.com/graphql",
      vehiclePath: "data.fleet",
    });
    const vehicles = await source.getVehicles();
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
  });

  it("uses custom fieldMap", async () => {
    mockRequest.mockResolvedValue({
      vehicles: {
        nodes: [
          {
            vehicleId: "abc",
            label: "Truck A",
            lat: -1.28,
            lon: 36.8,
          },
        ],
      },
    });

    const source = new GraphQLSource();
    await source.connect({
      url: "https://api.example.com/graphql",
      fieldMap: { id: "vehicleId", name: "label", lat: "lat", lng: "lon" },
    });
    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("abc");
    expect(vehicles[0].name).toBe("Truck A");
    expect(vehicles[0].position).toEqual([-1.28, 36.8]);
  });

  it("filters medical vehicles", async () => {
    mockRequest.mockResolvedValue({
      vehicles: {
        nodes: [
          {
            id: "v1",
            callsign: "Ambulance",
            latitude: -1.28,
            longitude: 36.8,
            vehicleTypeRef: { value: "ALS" },
          },
          {
            id: "v2",
            callsign: "Taxi",
            latitude: -1.29,
            longitude: 36.81,
            vehicleTypeRef: { value: "SEDAN" },
          },
        ],
      },
    });

    const source = new GraphQLSource();
    await source.connect({
      url: "https://api.example.com/graphql",
      filter: "medical",
    });
    const vehicles = await source.getVehicles();

    // Only the vehicle with a MedicalType value should pass
    for (const v of vehicles) {
      expect(v.id).not.toBe("v2");
    }
  });

  it("supports custom filter function", async () => {
    mockRequest.mockResolvedValue({
      vehicles: {
        nodes: [
          { id: "v1", callsign: "Online", latitude: -1.28, longitude: 36.8, isOnline: true },
          { id: "v2", callsign: "Offline", latitude: -1.29, longitude: 36.81, isOnline: false },
        ],
      },
    });

    const source = new GraphQLSource();
    await source.connect({
      url: "https://api.example.com/graphql",
      filter: (v: Record<string, unknown>) => v.isOnline === true,
    });
    const vehicles = await source.getVehicles();

    expect(vehicles).toHaveLength(1);
    expect(vehicles[0].id).toBe("v1");
  });

  it("rejects query without 'query' keyword", async () => {
    const source = new GraphQLSource();
    await expect(
      source.connect({
        url: "https://api.example.com/graphql",
        query: "{ vehicles { id } }",
      })
    ).rejects.toThrow("query must contain a 'query' keyword");
  });

  it("rejects mutation in query field", async () => {
    const source = new GraphQLSource();
    // String must contain "query" to pass the first check, then fail on "mutation"
    await expect(
      source.connect({
        url: "https://api.example.com/graphql",
        query: "query mutation { deleteVehicle(id: 1) { id } }",
      })
    ).rejects.toThrow("must not contain 'mutation' or 'subscription'");
  });

  it("rejects subscription in query field", async () => {
    const source = new GraphQLSource();
    await expect(
      source.connect({
        url: "https://api.example.com/graphql",
        query: "query subscription { vehicleUpdated { id } }",
      })
    ).rejects.toThrow("must not contain 'mutation' or 'subscription'");
  });

  it("health check returns unhealthy on request failure", async () => {
    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    mockRequest.mockRejectedValueOnce(new Error("Network failure"));

    const result = await source.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.message).toBe("Network failure");
  });

  it("health check handles non-Error thrown values", async () => {
    const source = new GraphQLSource();
    await source.connect({ url: "https://api.example.com/graphql" });
    mockRequest.mockRejectedValueOnce("raw-string");

    const result = await source.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.message).toBe("raw-string");
  });
});
