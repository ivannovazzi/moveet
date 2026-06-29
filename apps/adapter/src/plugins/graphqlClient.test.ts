import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { graphqlFetch, createResilientGraphQLClient } from "./graphqlClient";
import { HttpTimeoutError } from "../utils/httpClient";

describe("graphqlFetch (GraphQL resilience policy)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates to global fetch and returns the response", async () => {
    const okResponse = new Response("{}", { status: 200 });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(okResponse);

    const doFetch = graphqlFetch();
    const res = await doFetch("https://api.example.com/graphql", { method: "POST" });

    expect(res).toBe(okResponse);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.example.com/graphql");
  });

  it("enforces a timeout: a hung request is aborted and surfaces HttpTimeoutError", async () => {
    // Simulate a request that never resolves until the AbortController fires.
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal;
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });

    // timeoutMs short, maxRetries 1 so the single attempt times out fast.
    const doFetch = graphqlFetch({ timeoutMs: 10, maxRetries: 1 });
    await expect(doFetch("https://api.example.com/graphql", { method: "POST" })).rejects.toThrow(
      HttpTimeoutError
    );
  });

  it("retries transient (retryable) HTTP failures up to maxRetries", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response("err", { status: 503 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    // baseDelayMs is internal to httpFetch; with maxRetries 2 the second attempt
    // succeeds. We don't assert on timing, only that a retry happened.
    const doFetch = graphqlFetch({ maxRetries: 2 });
    const res = await doFetch("https://api.example.com/graphql", { method: "POST" });

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-retryable HTTP failures (e.g. 400)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("bad", { status: 400 }));

    const doFetch = graphqlFetch({ maxRetries: 3 });
    await expect(doFetch("https://api.example.com/graphql", { method: "POST" })).rejects.toThrow();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("createResilientGraphQLClient wires a fetch that goes through the policy", async () => {
    // The real GraphQLClient is used here (not mocked); we only need to confirm
    // the request transport is our policy-backed fetch by asserting the global
    // fetch is invoked when the client issues a request.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { __typename: "Query" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    const client = createResilientGraphQLClient(
      "https://api.example.com/graphql",
      { Authorization: "Bearer t" },
      { timeoutMs: 5000, maxRetries: 1 }
    );

    await client.request("{ __typename }");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe("https://api.example.com/graphql");
  });
});
