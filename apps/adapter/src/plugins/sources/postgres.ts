import type { PoolConfig } from "pg";
import { Pool } from "pg";
import type { ConfigField, DataSource, HealthCheckResult, PluginConfig } from "../types";
import type { ExportVehicle } from "../../types";
import { validateSqlQuery } from "./sql-validation";

interface PostgresFieldMap {
  id?: string;
  name?: string;
  lat?: string;
  lng?: string;
}

interface PostgresConfig extends PluginConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
  query?: string;
  fieldMap?: PostgresFieldMap;
}

const DEFAULT_QUERY = "SELECT id, name, latitude, longitude FROM vehicles";

export class PostgresSource implements DataSource {
  readonly type = "postgres";
  readonly name = "PostgreSQL Database";
  readonly configSchema: ConfigField[] = [
    {
      name: "connectionString",
      label: "Connection String",
      type: "string",
      placeholder: "postgresql://user:pass@host:5432/db",
    },
    { name: "host", label: "Host", type: "string" },
    { name: "port", label: "Port", type: "number", default: 5432 },
    { name: "user", label: "User", type: "string" },
    { name: "password", label: "Password", type: "password" },
    { name: "database", label: "Database", type: "string" },
    {
      name: "query",
      label: "Query",
      type: "string",
      default: DEFAULT_QUERY,
      placeholder:
        "Read-only SELECT only. DDL/DML keywords, comments, and multi-statement queries are blocked.",
    },
    { name: "fieldMap", label: "Field Map", type: "json" },
  ];
  private pool: Pool | null = null;
  private query: string = DEFAULT_QUERY;
  private fieldMap: Required<PostgresFieldMap> = {
    id: "id",
    name: "name",
    lat: "latitude",
    lng: "longitude",
  };

  async connect(config: PluginConfig): Promise<void> {
    const cfg = config as PostgresConfig;

    const rawQuery = cfg.query || DEFAULT_QUERY;
    const validation = validateSqlQuery(rawQuery);
    if (!validation.valid) {
      throw new Error(`PostgresSource: invalid query — ${validation.reason}`);
    }
    this.query = rawQuery;

    if (cfg.fieldMap) {
      this.fieldMap = { ...this.fieldMap, ...cfg.fieldMap };
    }

    const poolConfig: PoolConfig = cfg.connectionString
      ? { connectionString: cfg.connectionString, max: 10 }
      : {
          host: cfg.host,
          port: cfg.port || 5432,
          user: cfg.user,
          password: cfg.password,
          database: cfg.database,
          max: 10,
        };

    this.pool = new Pool(poolConfig);
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async getVehicles(): Promise<ExportVehicle[]> {
    if (!this.pool) {
      throw new Error("PostgresSource: not connected");
    }

    const result = await this.pool.query(this.query);

    return result.rows.map((row: Record<string, unknown>) => ({
      id: String(row[this.fieldMap.id]),
      name: String(row[this.fieldMap.name]),
      position: [Number(row[this.fieldMap.lat]), Number(row[this.fieldMap.lng])] as [
        number,
        number,
      ],
    }));
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.pool) return { healthy: false, message: "not connected" };
    try {
      const client = await this.pool.connect();
      await client.query("SELECT 1");
      client.release();
      return { healthy: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, message };
    }
  }
}
