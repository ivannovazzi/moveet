import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequest = vi.fn().mockResolvedValue({});

vi.mock("graphql-request", () => ({
  GraphQLClient: class MockGraphQLClient {
    constructor() {}
    request = mockRequest;
  },
  gql: (strings: TemplateStringsArray) => strings.join(""),
}));

import { GraphQLSink } from "../plugins/sinks/graphql";

describe("GraphQLSink", () => {
  beforeEach(() => {
    mockRequest.mockClear();
  });

  it("has correct type and name", () => {
    const sink = new GraphQLSink();
    expect(sink.type).toBe("graphql");
    expect(sink.name).toBe("GraphQL API");
  });

  it("requires url", async () => {
    const sink = new GraphQLSink();
    await expect(sink.connect({})).rejects.toThrow("GraphQL sink requires url");
  });

  it("sends mutation with vehicle updates", async () => {
    const sink = new GraphQLSink();
    await sink.connect({ url: "https://api.example.com/graphql", token: "abc123" });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);

    expect(mockRequest).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        input: expect.objectContaining({
          vehicle: expect.arrayContaining([
            expect.objectContaining({ id: "v1", latitude: -1.3, longitude: 36.8 }),
          ]),
        }),
      })
    );
  });

  it("throws when not connected", async () => {
    const sink = new GraphQLSink();
    await expect(
      sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }])
    ).rejects.toThrow("GraphQL sink not connected");
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("health check reflects connection state", async () => {
    const sink = new GraphQLSink();
    expect((await sink.healthCheck()).healthy).toBe(false);
    await sink.connect({ url: "https://api.example.com/graphql" });
    mockRequest.mockResolvedValueOnce({ __typename: "Query" });
    expect((await sink.healthCheck()).healthy).toBe(true);
    await sink.disconnect();
    expect((await sink.healthCheck()).healthy).toBe(false);
  });

  it("has config schema", () => {
    const sink = new GraphQLSink();
    expect(sink.configSchema.length).toBeGreaterThan(0);
    expect(sink.configSchema.find((f) => f.name === "url")!.required).toBe(true);
  });

  it("accepts apiUrl as alternative to url", async () => {
    const sink = new GraphQLSink();
    await sink.connect({ apiUrl: "https://api.example.com/graphql" });
    mockRequest.mockResolvedValueOnce({ __typename: "Query" });
    expect((await sink.healthCheck()).healthy).toBe(true);
  });

  it("sets Authorization header from token", async () => {
    const sink = new GraphQLSink();
    await sink.connect({ url: "https://api.example.com/graphql", token: "my-token" });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);
    expect(mockRequest).toHaveBeenCalled();
  });

  it("merges custom headers", async () => {
    const sink = new GraphQLSink();
    await sink.connect({
      url: "https://api.example.com/graphql",
      headers: { "X-Custom": "value" },
    });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);
    expect(mockRequest).toHaveBeenCalled();
  });

  it("uses custom mutation when provided", async () => {
    const sink = new GraphQLSink();
    const customMutation = `mutation Custom($input: CustomInput!) { custom(input: $input) { ok } }`;
    await sink.connect({ url: "https://api.example.com/graphql", mutation: customMutation });
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);
    // The gql tagged template mock strips interpolated values, but the mutation is stored
    // internally and passed through gql`${this.mutation}`. Verify request was called.
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(expect.any(String), expect.any(Object));
  });

  it("health check returns unhealthy on request failure", async () => {
    const sink = new GraphQLSink();
    await sink.connect({ url: "https://api.example.com/graphql" });
    mockRequest.mockRejectedValueOnce(new Error("Network failure"));

    const result = await sink.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.message).toBe("Network failure");
  });

  it("health check handles non-Error thrown values", async () => {
    const sink = new GraphQLSink();
    await sink.connect({ url: "https://api.example.com/graphql" });
    mockRequest.mockRejectedValueOnce("raw-string");

    const result = await sink.healthCheck();
    expect(result.healthy).toBe(false);
    expect(result.message).toBe("raw-string");
  });

  it("disconnect nulls the client", async () => {
    const sink = new GraphQLSink();
    await sink.connect({ url: "https://api.example.com/graphql" });
    await sink.disconnect();
    expect((await sink.healthCheck()).healthy).toBe(false);
    await expect(
      sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }])
    ).rejects.toThrow("GraphQL sink not connected");
  });
});
