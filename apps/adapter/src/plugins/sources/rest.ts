import type { ConfigField, DataSource, HealthCheckResult, PluginConfig } from "../types";
import type { ExportVehicle } from "../../types";
import { getNestedValue } from "../utils";
import { httpFetch } from "../../utils/httpClient";
import { createLogger } from "../../utils/logger";

const logger = createLogger("RestSource");

interface FieldMap {
  id: string;
  name: string;
  lat: string;
  lng: string;
}

/** A filter scalar: compared to the item's value after String() coercion. */
type FilterScalar = string | number | boolean;

/**
 * Normalised item filter: each dot-path maps to the set of accepted values
 * (already String()-coerced). An item is kept when EVERY path matches.
 */
type ItemFilter = Array<[path: string, accepted: Set<string>]>;

const isFilterScalar = (value: unknown): value is FilterScalar =>
  typeof value === "string" ||
  (typeof value === "number" && Number.isFinite(value)) ||
  typeof value === "boolean";

/**
 * Validate and normalise the `filter` config: an object mapping a dot-path to
 * an expected scalar or a non-empty array of accepted scalars. A JSON string is
 * accepted too, since the shared config validator accepts one for json fields.
 * Throws a descriptive error for any other shape.
 */
function parseFilter(raw: unknown): ItemFilter {
  if (raw === undefined || raw === null || raw === "") return [];
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error(
        "REST source filter must be a JSON object (the string is not parseable JSON)"
      );
    }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(
      'REST source filter must be an object mapping a field path to a value or an array of values, e.g. {"deviceType":"tracker"}'
    );
  }
  return Object.entries(value as Record<string, unknown>).map(([path, expected]) => {
    const values = Array.isArray(expected) ? expected : [expected];
    if (values.length === 0 || !values.every(isFilterScalar)) {
      throw new Error(
        `REST source filter "${path}" must be a string, number or boolean, or a non-empty array of them`
      );
    }
    return [path, new Set(values.map((v) => String(v)))];
  });
}

const DEFAULT_FIELD_MAP: FieldMap = {
  id: "id",
  name: "name",
  lat: "lat",
  lng: "lng",
};

export class RestSource implements DataSource {
  readonly type = "rest";
  readonly name = "REST API";
  readonly configSchema: ConfigField[] = [
    { name: "url", label: "URL", type: "string", required: true },
    {
      name: "method",
      label: "Method",
      type: "select",
      options: [
        { label: "GET", value: "GET" },
        { label: "POST", value: "POST" },
      ],
    },
    { name: "headers", label: "Headers", type: "json" },
    { name: "body", label: "Body", type: "json" },
    {
      name: "vehiclePath",
      label: "Vehicle Path",
      type: "string",
      default: "vehicles",
    },
    { name: "fieldMap", label: "Field Map", type: "json" },
    { name: "metadataMap", label: "Metadata Map", type: "json" },
    {
      name: "groupBy",
      label: "Group By",
      type: "string",
      placeholder: "e.g. vehicleId",
      description:
        "Optional field path. When set, items are grouped by this value and each GROUP becomes one entity (id = the groupBy value); every item in the group is recorded under metadata.devices. Unset = one entity per item.",
    },
    {
      name: "filter",
      label: "Filter",
      type: "json",
      placeholder: '{"deviceType":"tracker"}',
      description:
        'Optional. Keep only items where EVERY field path matches: {"path":value} or {"path":[value, ...]} (array = any of). Values are compared as strings, so 1 matches "1". Applied before groupBy and limit, so limit counts filtered entities. Unset = keep every item.',
    },
    {
      name: "limit",
      label: "Limit",
      type: "number",
      placeholder: "0",
      description:
        "Sample only the first N entities from the roster (0 or unset = no limit). When groupBy is set, the limit applies to the number of groups. Useful for capping a large source.",
    },
  ];
  private url: string | null = null;
  private headers: Record<string, string> = {};
  private method: "GET" | "POST" = "GET";
  private body: unknown = undefined;
  private vehiclePath: string = "vehicles";
  private fieldMap: FieldMap = { ...DEFAULT_FIELD_MAP };
  private metadataMap: Record<string, string> = {};
  // Optional field path. When set, items are grouped by this value and each
  // group becomes one entity. null = disabled (one entity per item).
  private groupBy: string | null = null;
  // 0 = no limit. Otherwise, sample only the first N entities from the roster.
  // When groupBy is set, the limit applies to the number of groups.
  private limit: number = 0;
  // Applied to the raw items before groupBy and limit. Empty = keep everything.
  private filter: ItemFilter = [];

  async connect(config: PluginConfig): Promise<void> {
    const url = config.url as string;
    if (!url) throw new Error("REST source requires url");
    // Validate before mutating any state so a bad filter leaves the source as it was.
    const filter = parseFilter(config.filter);
    this.url = url;
    this.headers = (config.headers as Record<string, string>) || {};
    this.method = ((config.method as string) || "GET").toUpperCase() as "GET" | "POST";
    this.body = config.body;
    this.vehiclePath = (config.vehiclePath as string) || "vehicles";
    this.fieldMap = {
      ...DEFAULT_FIELD_MAP,
      ...((config.fieldMap as Partial<FieldMap>) || {}),
    };
    this.metadataMap = (config.metadataMap as Record<string, string>) || {};
    const groupBy = config.groupBy;
    this.groupBy = typeof groupBy === "string" && groupBy.trim() !== "" ? groupBy : null;
    // Coerce to a non-negative integer; anything invalid/unset means no limit.
    const rawLimit = Number(config.limit);
    this.limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : 0;
    this.filter = filter;
  }

  async disconnect(): Promise<void> {
    this.url = null;
    this.headers = {};
    this.method = "GET";
    this.body = undefined;
    this.vehiclePath = "vehicles";
    this.fieldMap = { ...DEFAULT_FIELD_MAP };
    this.metadataMap = {};
    this.groupBy = null;
    this.limit = 0;
    this.filter = [];
  }

  async getVehicles(): Promise<ExportVehicle[]> {
    if (!this.url) {
      throw new Error("RestSource: not connected");
    }

    const fetchOptions: RequestInit = {
      method: this.method,
      headers: { "Content-Type": "application/json", ...this.headers },
    };

    if (this.method === "POST" && this.body !== undefined) {
      fetchOptions.body = JSON.stringify(this.body);
    }

    const response = await httpFetch(this.url, fetchOptions);

    const json = await response.json();
    const rawItems = getNestedValue(json, this.vehiclePath);

    if (!Array.isArray(rawItems)) {
      throw new Error(`Expected array at path "${this.vehiclePath}", got ${typeof rawItems}`);
    }

    // Filter first, so groupBy only sees kept items and limit counts them.
    const items =
      this.filter.length > 0 ? rawItems.filter((item) => this.matchesFilter(item)) : rawItems;

    if (this.groupBy) {
      return this.groupItems(items, this.groupBy);
    }

    // Optionally sample the first N items before mapping (e.g. to keep a large
    // roster from overwhelming downstream consumers). 0 = no limit.
    const sampled = this.limit > 0 ? items.slice(0, this.limit) : items;

    return sampled.flatMap((item: unknown) => {
      const record = item as Record<string, unknown>;
      const id = String(getNestedValue(record, this.fieldMap.id) ?? "");
      const name = String(getNestedValue(record, this.fieldMap.name) ?? id);

      const vehicle: ExportVehicle = { id, name };

      const position = this.resolvePosition(record, id);
      // `null` signals invalid coordinates → drop the item.
      if (position === null) return [];
      if (position) vehicle.position = position;

      // Metadata: resolve each configured path against the item, keeping only
      // present (non-undefined) values. Leave undefined when nothing resolves.
      const metadata = this.resolveMetadata(record);
      if (Object.keys(metadata).length > 0) {
        vehicle.metadata = metadata;
      }

      return [vehicle];
    });
  }

  /**
   * Group the raw items by their resolved `groupBy` value, producing ONE
   * {@link ExportVehicle} per group: the group key is the entity `id`, the
   * group's first item seeds the optional position, and every item in the
   * group is recorded under `metadata.devices` as `{ id, ...metadataMap }`.
   * `limit` applies to the number of groups. Insertion order is preserved.
   */
  private groupItems(items: unknown[], groupBy: string): ExportVehicle[] {
    const groups = new Map<string, Record<string, unknown>[]>();
    for (const item of items) {
      const record = item as Record<string, unknown>;
      const rawKey = getNestedValue(record, groupBy);
      if (rawKey === undefined || rawKey === null) continue;
      const key = String(rawKey);
      const group = groups.get(key);
      if (group) {
        group.push(record);
      } else {
        groups.set(key, [record]);
      }
    }

    const entries = Array.from(groups.entries());
    const sampled = this.limit > 0 ? entries.slice(0, this.limit) : entries;

    return sampled.map(([id, records]) => {
      const vehicle: ExportVehicle = { id, name: id };

      // Position (optional) is seeded from the group's first item.
      const position = this.resolvePosition(records[0], id);
      if (position) vehicle.position = position;

      // One device entry per item in the group: { id, ...metadataMap }.
      const devices = records.map((record) => ({
        id: String(getNestedValue(record, this.fieldMap.id) ?? ""),
        ...this.resolveMetadata(record),
      }));

      vehicle.metadata = { devices };
      return vehicle;
    });
  }

  /**
   * True when every filter path resolves (via the prototype-pollution-guarded
   * {@link getNestedValue}, so an unsafe path never matches) to a scalar whose
   * String() form is one of the accepted values.
   */
  private matchesFilter(item: unknown): boolean {
    return this.filter.every(([path, accepted]) => {
      const value = getNestedValue(item, path);
      return isFilterScalar(value) && accepted.has(String(value));
    });
  }

  /**
   * Resolve the optional position for a record. Returns `undefined` when no
   * coordinates are present, `null` when they are present but invalid (the
   * caller should drop the item), or the `[lat, lng]` pair otherwise.
   */
  private resolvePosition(
    record: Record<string, unknown>,
    id: string
  ): [number, number] | null | undefined {
    const rawLat = getNestedValue(record, this.fieldMap.lat);
    const rawLng = getNestedValue(record, this.fieldMap.lng);
    if (rawLat === undefined || rawLng === undefined) return undefined;

    const lat = Number(rawLat);
    const lng = Number(rawLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      logger.warn({ vehicleId: id, lat, lng }, `Skipping vehicle "${id}": invalid coordinates`);
      return null;
    }
    return [lat, lng];
  }

  /**
   * Resolve the configured `metadataMap` paths against a record, keeping only
   * present (non-undefined) values.
   */
  private resolveMetadata(record: Record<string, unknown>): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    for (const [key, path] of Object.entries(this.metadataMap)) {
      const value = getNestedValue(record, path);
      if (value !== undefined) {
        metadata[key] = value;
      }
    }
    return metadata;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    if (!this.url) return { healthy: false, message: "not connected" };
    try {
      await httpFetch(this.url, { method: "HEAD" }, { timeoutMs: 3000, maxRetries: 1 });
      return { healthy: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { healthy: false, message };
    }
  }
}
