import { GraphQLClient } from "graphql-request";
import { httpFetch, type HttpClientOptions } from "../utils/httpClient";

/**
 * Resilience policy shared by the GraphQL source and sink. The GraphQL plugins
 * are the adapter's core external bridge, yet `graphql-request`'s `GraphQLClient`
 * is created with no timeout/retry by default — a hung external API would hang
 * `GET /vehicles` / `POST /sync` indefinitely. We route every GraphQL request
 * through the same {@link httpFetch} policy (timeout + bounded exponential
 * backoff with jitter) the REST plugins already use.
 *
 * graphql-request issues a single `POST` per `request()` call; passing a custom
 * `fetch` lets us interpose the policy transparently. Note that any retries here
 * re-send the same GraphQL operation, so the SINK mutation must be idempotent
 * (the canonical `upsertVehicles` mutation is — it upserts by id).
 */
export interface GraphQLClientPolicy {
  /** Per-request timeout in ms. Default: httpFetch default (10s). */
  timeoutMs?: number;
  /** Max attempts (1 = no retry). Default: httpFetch default (3). */
  maxRetries?: number;
}

/**
 * A `fetch` implementation that delegates to {@link httpFetch}, giving GraphQL
 * requests the same timeout + retry/backoff behaviour as the REST plugins.
 *
 * Exposed (rather than only used internally) so tests can assert the policy is
 * wired and exercise the timeout path directly.
 */
export function graphqlFetch(
  policy: GraphQLClientPolicy = {}
): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  const options: HttpClientOptions = {};
  if (policy.timeoutMs != null) options.timeoutMs = policy.timeoutMs;
  if (policy.maxRetries != null) options.maxRetries = policy.maxRetries;
  return (input, init) => httpFetch(String(input), init ?? {}, options);
}

/**
 * Build a `GraphQLClient` whose underlying transport is {@link httpFetch}, so
 * the request is bounded by a timeout and retried on transient failures rather
 * than hanging forever on an unresponsive endpoint.
 */
export function createResilientGraphQLClient(
  url: string,
  headers: Record<string, string>,
  policy: GraphQLClientPolicy = {}
): GraphQLClient {
  return new GraphQLClient(url, { headers, fetch: graphqlFetch(policy) });
}
