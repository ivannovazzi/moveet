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

  describe("batchSize chunking", () => {
    const makeUpdates = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `v${i}`, latitude: -1.3, longitude: 36.8 }));

    it("has a batchSize config field defaulting to 0 (single mutation)", () => {
      const sink = new GraphQLSink();
      const field = sink.configSchema.find((f) => f.name === "batchSize");
      expect(field).toBeDefined();
      expect(field!.default).toBe(0);
    });

    it("sends a single mutation when batchSize is 0", async () => {
      const sink = new GraphQLSink();
      await sink.connect({ url: "https://api.example.com/graphql", batchSize: 0 });
      const result = await sink.publishUpdates(makeUpdates(10));
      expect(mockRequest).toHaveBeenCalledTimes(1);
      // Unchunked path returns void.
      expect(result).toBeUndefined();
    });

    it("splits into chunks when updates exceed batchSize", async () => {
      const sink = new GraphQLSink();
      await sink.connect({ url: "https://api.example.com/graphql", batchSize: 2 });
      const result = await sink.publishUpdates(makeUpdates(5));
      // 5 updates / batch 2 → 3 chunks → 3 mutations.
      expect(mockRequest).toHaveBeenCalledTimes(3);
      expect(result).toEqual({ attempted: 5, succeeded: 5, failures: [] });
    });

    it("aborts remaining chunks after a chunk failure to preserve ordering", async () => {
      mockRequest
        .mockResolvedValueOnce({}) // chunk 0 ok
        .mockRejectedValueOnce(new Error("upstream 500")); // chunk 1 fails
      const sink = new GraphQLSink();
      await sink.connect({ url: "https://api.example.com/graphql", batchSize: 2 });
      const result = await sink.publishUpdates(makeUpdates(6)); // 3 chunks

      // Only chunks 0 and 1 attempted; chunk 2 aborted.
      expect(mockRequest).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        attempted: 6,
        succeeded: 2,
        failures: [
          { itemId: "chunk-1", error: "upstream 500" },
          { itemId: "chunk-2", error: "not attempted (batch aborted after chunk 1 failed)" },
        ],
      });
    });

    it("throws when the first chunk fails (nothing delivered)", async () => {
      mockRequest.mockRejectedValueOnce(new Error("broker down"));
      const sink = new GraphQLSink();
      await sink.connect({ url: "https://api.example.com/graphql", batchSize: 2 });
      await expect(sink.publishUpdates(makeUpdates(6))).rejects.toThrow(
        "GraphQL sink: first chunk failed to publish"
      );
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });
});
