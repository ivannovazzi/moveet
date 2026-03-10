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

  it("does nothing when not connected", async () => {
    const sink = new GraphQLSink();
    await sink.publishUpdates([{ id: "v1", latitude: -1.3, longitude: 36.8 }]);
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
});
