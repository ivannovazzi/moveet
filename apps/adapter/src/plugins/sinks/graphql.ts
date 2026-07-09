import { gql, type GraphQLClient } from "graphql-request";
import type {
  ConfigField,
  DataSink,
  HealthCheckResult,
  PluginConfig,
  SinkItemFailure,
  SinkPublishResult,
} from "../types";
import type { VehicleUpdate } from "../../types";
import { createResilientGraphQLClient } from "../graphqlClient";
import { createLogger } from "../../utils/logger";

const logger = createLogger("GraphQLSink");

const DEFAULT_MUTATION = `mutation SendLocation($input: UpsertVehiclesInput!) {
  upsertVehicles(input: $input) {
    vehicles { callsign latitude longitude }
    clientMutationId
  }
}`;

type VariablesTransformFn = (updates: VehicleUpdate[]) => Record<string, unknown>;

const defaultVariablesTransform: VariablesTransformFn = (updates) => ({
  input: {
    vehicle: updates.map((v) => ({
      latitude: v.latitude,
      longitude: v.longitude,
      id: v.id,
      type: v.type,
      positionReceivedAt: new Date().toISOString(),
    })),
  },
});

export class GraphQLSink implements DataSink {
  readonly type = "graphql";
  readonly name = "GraphQL API";
  readonly configSchema: ConfigField[] = [
    { name: "url", label: "URL", type: "string", required: true },
    { name: "token", label: "Auth Token", type: "password" },
    {
      name: "mutation",
      label: "Mutation",
      type: "string",
      default: DEFAULT_MUTATION,
    },
    { name: "headers", label: "Headers", type: "json" },
    {
      name: "batchSize",
      label: "Max Batch Size",
      type: "number",
      default: 0,
      description:
        "Max vehicle updates per mutation (0 = single mutation with all updates). Larger batches are split into sequential chunks; on a chunk failure, remaining chunks are aborted to preserve ordering.",
    },
    {
      name: "timeoutMs",
      label: "Request Timeout (ms)",
      type: "number",
      default: 10000,
      description: "Per-request timeout; the request is aborted and retried/failed after this.",
    },
    {
      name: "maxRetries",
      label: "Max Attempts",
      type: "number",
      default: 3,
      description: "Total attempts on transient failures (1 = no retry).",
    },
  ];
  private client: GraphQLClient | null = null;
  private mutation: string = DEFAULT_MUTATION;
  private variablesTransform: VariablesTransformFn = defaultVariablesTransform;
  // 0 = send a single mutation with all updates (prior behaviour). Otherwise
  // split into sequential chunks of at most this many updates.
  private batchSize = 0;

  async connect(config: PluginConfig): Promise<void> {
    const url = (config.url as string) || (config.apiUrl as string);
    if (!url) throw new Error("GraphQL sink requires url");

    const headers: Record<string, string> = {};
    if (config.headers && typeof config.headers === "object") {
      Object.assign(headers, config.headers);
    }
    if (config.token) {
      headers["Authorization"] = `Bearer ${config.token as string}`;
    }

    this.client = createResilientGraphQLClient(url, headers, {
      timeoutMs: config.timeoutMs != null ? Number(config.timeoutMs) : undefined,
      maxRetries: config.maxRetries != null ? Number(config.maxRetries) : undefined,
    });

    if (config.mutation) this.mutation = config.mutation as string;
    if (typeof config.variablesTransform === "function") {
      this.variablesTransform = config.variablesTransform as VariablesTransformFn;
    }

    // Coerce to a non-negative integer; anything invalid/unset means no chunking.
    const rawBatch = Number(config.batchSize);
    this.batchSize = Number.isFinite(rawBatch) && rawBatch > 0 ? Math.floor(rawBatch) : 0;
  }

  async disconnect(): Promise<void> {
    this.client = null;
  }

  private async sendMutation(client: GraphQLClient, updates: VehicleUpdate[]): Promise<void> {
    const variables = this.variablesTransform(updates);
    await client.request(
      gql`
        ${this.mutation}
      `,
      variables
    );
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<SinkPublishResult | void> {
    if (!this.client) throw new Error("GraphQL sink not connected");
    const client = this.client;

    // Unchunked: single mutation carrying every update (prior behaviour).
    if (this.batchSize === 0 || updates.length <= this.batchSize) {
      await this.sendMutation(client, updates);
      return;
    }

    // Chunked: sequential mutations, aborting the remainder on the first failure
    // so a retried/late chunk can't be delivered out of order (mirrors the
    // redpanda sink's ordering-preserving chunk semantics).
    const chunks: VehicleUpdate[][] = [];
    for (let i = 0; i < updates.length; i += this.batchSize) {
      chunks.push(updates.slice(i, i + this.batchSize));
    }

    let succeeded = 0;
    const failures: SinkItemFailure[] = [];

    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      try {
        await this.sendMutation(client, chunks[chunkIndex]);
        succeeded += chunks[chunkIndex].length;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error({ chunkIndex, error }, `GraphQL sink chunk ${chunkIndex} failed`);
        failures.push({ itemId: `chunk-${chunkIndex}`, error });
        for (let j = chunkIndex + 1; j < chunks.length; j++) {
          failures.push({
            itemId: `chunk-${j}`,
            error: `not attempted (batch aborted after chunk ${chunkIndex} failed)`,
          });
        }
        break;
      }
    }

    // First chunk failed: surface as a thrown error so the publisher marks the
    // whole sink failed (consistent with the unchunked path throwing).
    if (succeeded === 0 && failures.length > 0) {
      throw new Error(`GraphQL sink: first chunk failed to publish. Error: ${failures[0].error}`);
    }

    return { attempted: updates.length, succeeded, failures };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.client) return { healthy: false, message: "not connected" };
    try {
      await this.client.request(gql`
        {
          __typename
        }
      `);
      return { healthy: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, message };
    }
  }
}
