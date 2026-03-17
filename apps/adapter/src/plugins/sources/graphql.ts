import { gql, GraphQLClient } from "graphql-request";
import type { ConfigField, DataSource, HealthCheckResult, PluginConfig } from "../types";
import type { ExportVehicle, Vehicle } from "../../types";
import { MedicalType } from "../../types";

function isMedical(vehicle: Vehicle): boolean {
  return Object.values(MedicalType).includes(vehicle.vehicleTypeRef?.value as MedicalType);
}

const DEFAULT_QUERY = `query { vehicles { nodes { id callsign isOnline _currentShift { id } _trackingType vehicleTypeRef { value } latitude longitude } } }`;
const DEFAULT_VEHICLE_PATH = "vehicles.nodes";
const DEFAULT_FIELD_MAP = { id: "id", name: "callsign", lat: "latitude", lng: "longitude" };

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function isSafePath(path: string): boolean {
  return !path.split(".").some((key) => FORBIDDEN_KEYS.has(key));
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  if (!isSafePath(path)) return undefined;
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function getFieldValue(obj: Record<string, unknown>, path: string): unknown {
  return getNestedValue(obj, path);
}

export class GraphQLSource implements DataSource {
  readonly type = "graphql";
  readonly name = "GraphQL API";
  readonly configSchema: ConfigField[] = [
    { name: "url", label: "URL", type: "string", required: true },
    { name: "token", label: "Auth Token", type: "password" },
    { name: "query", label: "Query", type: "string", default: DEFAULT_QUERY },
    { name: "vehiclePath", label: "Vehicle Path", type: "string", default: "vehicles.nodes" },
    { name: "maxVehicles", label: "Max Vehicles", type: "number", default: 0 },
    {
      name: "filter",
      label: "Filter",
      type: "select",
      options: [
        { label: "None", value: "none" },
        { label: "Medical", value: "medical" },
      ],
    },
    { name: "fieldMap", label: "Field Map", type: "json" },
  ];
  private client: GraphQLClient | null = null;
  private query: string = DEFAULT_QUERY;
  private vehiclePath: string = DEFAULT_VEHICLE_PATH;
  private maxVehicles: number = 0;
  private fieldMap: { id: string; name: string; lat: string; lng: string } = {
    ...DEFAULT_FIELD_MAP,
  };
  private filterFn: ((vehicle: Record<string, unknown>) => boolean) | null = null;

  async connect(config: PluginConfig): Promise<void> {
    const url = (config.url as string) || (config.apiUrl as string);
    if (!url) throw new Error("GraphQL source requires url");

    const headers: Record<string, string> = {};
    if (config.headers && typeof config.headers === "object") {
      Object.assign(headers, config.headers);
    }
    if (config.token) {
      headers["Authorization"] = `Bearer ${config.token as string}`;
    }

    this.client = new GraphQLClient(url, { headers });

    if (config.query) this.query = config.query as string;
    if (config.vehiclePath) this.vehiclePath = config.vehiclePath as string;
    if (config.maxVehicles) this.maxVehicles = config.maxVehicles as number;

    if (config.fieldMap && typeof config.fieldMap === "object") {
      const fm = config.fieldMap as Partial<typeof DEFAULT_FIELD_MAP>;
      const unsafePaths = Object.entries(fm).filter(
        ([, v]) => typeof v === "string" && !isSafePath(v)
      );
      if (unsafePaths.length > 0) {
        throw new Error(
          `GraphQL source: unsafe field map paths: ${unsafePaths.map(([k]) => k).join(", ")}`
        );
      }
      this.fieldMap = {
        ...DEFAULT_FIELD_MAP,
        ...fm,
      };
    }

    if (config.filter === "medical") {
      this.filterFn = (v) => isMedical(v as unknown as Vehicle);
    } else if (typeof config.filter === "function") {
      this.filterFn = config.filter as (vehicle: Record<string, unknown>) => boolean;
    }
  }

  async disconnect(): Promise<void> {
    this.client = null;
  }

  async getVehicles(): Promise<ExportVehicle[]> {
    if (!this.client) {
      throw new Error("GraphQLSource: not connected");
    }
    try {
      const response = await this.client.request<Record<string, unknown>>(gql`
        ${this.query}
      `);
      let vehicles = getNestedValue(response, this.vehiclePath) as Record<string, unknown>[];
      if (!Array.isArray(vehicles)) {
        throw new Error(
          `GraphQLSource: expected array at path "${this.vehiclePath}", got ${typeof vehicles}`
        );
      }

      if (this.filterFn) {
        vehicles = vehicles.filter(this.filterFn);
      }

      if (this.maxVehicles > 0) {
        vehicles = vehicles.slice(0, this.maxVehicles);
      }

      return vehicles
        .filter((v) => {
          const lat = Number(getFieldValue(v, this.fieldMap.lat));
          const lng = Number(getFieldValue(v, this.fieldMap.lng));
          return Number.isFinite(lat) && Number.isFinite(lng);
        })
        .map((v) => ({
          id: getFieldValue(v, this.fieldMap.id) as string,
          name: getFieldValue(v, this.fieldMap.name) as string,
          position: [
            getFieldValue(v, this.fieldMap.lat) as number,
            getFieldValue(v, this.fieldMap.lng) as number,
          ] as [number, number],
        }));
    } catch (error) {
      console.error("GraphQL source error:", error);
      throw error;
    }
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
