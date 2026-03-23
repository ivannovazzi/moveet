import { gql, GraphQLClient } from "graphql-request";
import type { ConfigField, DataSink, HealthCheckResult, PluginConfig } from "../types";
import type { VehicleUpdate } from "../../types";

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
    { name: "mutation", label: "Mutation", type: "string", default: DEFAULT_MUTATION },
    { name: "headers", label: "Headers", type: "json" },
  ];
  private client: GraphQLClient | null = null;
  private mutation: string = DEFAULT_MUTATION;
  private variablesTransform: VariablesTransformFn = defaultVariablesTransform;

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

    this.client = new GraphQLClient(url, { headers });

    if (config.mutation) this.mutation = config.mutation as string;
    if (typeof config.variablesTransform === "function") {
      this.variablesTransform = config.variablesTransform as VariablesTransformFn;
    }
  }

  async disconnect(): Promise<void> {
    this.client = null;
  }

  async publishUpdates(updates: VehicleUpdate[]): Promise<void> {
    if (!this.client) throw new Error("GraphQL sink not connected");
    const variables = this.variablesTransform(updates);
    await this.client.request(
      gql`
        ${this.mutation}
      `,
      variables
    );
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
