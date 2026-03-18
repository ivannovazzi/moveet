import type { Pool, PoolOptions } from "mysql2/promise";
import mysql from "mysql2/promise";
import type { ConfigField, DataSource, HealthCheckResult, PluginConfig } from "../types";
import type { ExportVehicle } from "../../types";
import { validateSqlQuery } from "./sql-validation";
import { createLogger } from "../../utils/logger";

const logger = createLogger("MySQLSource");

interface MySQLFieldMap {
  id?: string;
  name?: string;
  lat?: string;
  lng?: string;
}

interface MySQLConfig extends PluginConfig {
  host: string;
  port?: number;
  user: string;
  password: string;
  database: string;
  query?: string;
  fieldMap?: MySQLFieldMap;
}

const DEFAULT_QUERY = "SELECT id, name, latitude, longitude FROM vehicles";

export class MySQLSource implements DataSource {
  readonly type = "mysql";
  readonly name = "MySQL Database";
  readonly configSchema: ConfigField[] = [
    { name: "host", label: "Host", type: "string", required: true },
    { name: "port", label: "Port", type: "number", default: 3306 },
    { name: "user", label: "User", type: "string", required: true },
    { name: "password", label: "Password", type: "password", required: true },
    { name: "database", label: "Database", type: "string", required: true },
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
  private fieldMap: Required<MySQLFieldMap> = {
    id: "id",
    name: "name",
    lat: "latitude",
    lng: "longitude",
  };

  async connect(config: PluginConfig): Promise<void> {
    const cfg = config as MySQLConfig;

    const rawQuery = cfg.query || DEFAULT_QUERY;
    const validation = validateSqlQuery(rawQuery);
    if (!validation.valid) {
      throw new Error(`MySQLSource: invalid query — ${validation.reason}`);
    }
    this.query = rawQuery;

    if (cfg.fieldMap) {
      this.fieldMap = { ...this.fieldMap, ...cfg.fieldMap };
    }

    const poolOptions: PoolOptions = {
      host: cfg.host,
      port: cfg.port || 3306,
      user: cfg.user,
      password: cfg.password,
      database: cfg.database,
      waitForConnections: true,
      connectionLimit: 10,
    };

    this.pool = mysql.createPool(poolOptions);
  }

  async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
  }

  async getVehicles(): Promise<ExportVehicle[]> {
    if (!this.pool) {
      throw new Error("MySQLSource: not connected");
    }

    const [rows] = await this.pool.execute(this.query);
    const records = rows as Record<string, unknown>[];

    if (records.length > 0) {
      const firstRow = records[0];
      const columns = Object.keys(firstRow);
      for (const [field, column] of Object.entries(this.fieldMap)) {
        if (!columns.includes(column)) {
          logger.warn(
            { field, column, availableColumns: columns },
            `fieldMap.${field} references column "${column}" which does not exist in query results`
          );
        }
      }
    }

    return records.flatMap((row, index) => {
      const idVal = row[this.fieldMap.id];
      const latVal = row[this.fieldMap.lat];
      const lngVal = row[this.fieldMap.lng];

      if (idVal === undefined || latVal === undefined || lngVal === undefined) {
        logger.warn(
          { rowIndex: index, id: idVal, lat: latVal, lng: lngVal },
          `Skipping row ${index}: missing critical field(s)`
        );
        return [];
      }

      const id = String(idVal);
      const name = String(row[this.fieldMap.name] ?? id);
      const lat = Number(latVal);
      const lng = Number(lngVal);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        logger.warn({ vehicleId: id, lat, lng }, `Skipping vehicle "${id}": invalid coordinates`);
        return [];
      }

      return [{ id, name, position: [lat, lng] as [number, number] }];
    });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.pool) return { healthy: false, message: "not connected" };
    try {
      const conn = await this.pool.getConnection();
      await conn.ping();
      conn.release();
      return { healthy: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, message };
    }
  }
}
