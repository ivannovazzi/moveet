import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import SwaggerParser from "@apidevtools/swagger-parser";
import YAML from "yaml";

const SPEC_PATH = path.resolve(__dirname, "../../openapi.yaml");

// ─── Helpers ────────────────────────────────────────────────────────

function loadSpec(): Record<string, unknown> {
  const raw = fs.readFileSync(SPEC_PATH, "utf-8");
  return YAML.parse(raw) as Record<string, unknown>;
}

/**
 * Extracts all "METHOD /path" strings from the Express index.ts source code.
 * Matches app.get, app.post, app.delete, app.put, app.patch patterns.
 */
function extractRoutesFromSource(): Set<string> {
  const indexPath = path.resolve(__dirname, "../index.ts");
  const source = fs.readFileSync(indexPath, "utf-8");
  const routeRegex = /app\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  const routes = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = routeRegex.exec(source)) !== null) {
    const method = match[1].toUpperCase();
    const routePath = match[2];
    routes.add(`${method} ${routePath}`);
  }
  return routes;
}

/**
 * Extracts all "METHOD /path" strings from the OpenAPI spec paths.
 */
function extractRoutesFromSpec(spec: Record<string, unknown>): Set<string> {
  const paths = spec.paths as Record<string, Record<string, unknown>>;
  const routes = new Set<string>();
  for (const [pathStr, methods] of Object.entries(paths)) {
    for (const method of Object.keys(methods)) {
      if (["get", "post", "put", "patch", "delete"].includes(method)) {
        // Convert OpenAPI path params {id} to Express :id for comparison
        const expressPath = pathStr.replace(/\{(\w+)\}/g, ":$1");
        routes.add(`${method.toUpperCase()} ${expressPath}`);
      }
    }
  }
  return routes;
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("OpenAPI specification", () => {
  it("openapi.yaml file exists", () => {
    expect(fs.existsSync(SPEC_PATH)).toBe(true);
  });

  it("is valid YAML", () => {
    const raw = fs.readFileSync(SPEC_PATH, "utf-8");
    expect(() => YAML.parse(raw)).not.toThrow();
  });

  it("passes full OpenAPI 3.0 validation", async () => {
    // SwaggerParser.validate dereferences + validates the full spec
    const api = await SwaggerParser.validate(SPEC_PATH);
    expect(api).toBeDefined();
    expect((api as Record<string, unknown>).openapi).toMatch(/^3\./);
  });

  it("has required top-level fields", () => {
    const spec = loadSpec();
    expect(spec.openapi).toBeDefined();
    expect(spec.info).toBeDefined();
    expect(spec.paths).toBeDefined();
    expect(spec.components).toBeDefined();
  });

  it("declares all expected tags", () => {
    const spec = loadSpec();
    const tags = (spec.tags as { name: string }[]).map((t) => t.name);
    const expectedTags = [
      "Simulation",
      "Vehicles",
      "Network",
      "Heat Zones",
      "Incidents",
      "Recording",
      "Replay",
      "Clock",
      "Traffic",
      "Fleets",
    ];
    for (const tag of expectedTags) {
      expect(tags).toContain(tag);
    }
  });

  describe("route coverage", () => {
    it("every Express route is documented in the spec", () => {
      const spec = loadSpec();
      const sourceRoutes = extractRoutesFromSource();
      const specRoutes = extractRoutesFromSpec(spec);

      const undocumented: string[] = [];
      for (const route of sourceRoutes) {
        if (!specRoutes.has(route)) {
          undocumented.push(route);
        }
      }

      expect(undocumented).toEqual([]);
    });

    it("every spec route exists in the Express source", () => {
      const spec = loadSpec();
      const sourceRoutes = extractRoutesFromSource();
      const specRoutes = extractRoutesFromSpec(spec);

      const phantom: string[] = [];
      for (const route of specRoutes) {
        if (!sourceRoutes.has(route)) {
          phantom.push(route);
        }
      }

      expect(phantom).toEqual([]);
    });
  });

  describe("response schemas", () => {
    it("every path operation has at least one response", () => {
      const spec = loadSpec();
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const missing: string[] = [];

      for (const [pathStr, methods] of Object.entries(paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
          if (!operation.responses || Object.keys(operation.responses).length === 0) {
            missing.push(`${method.toUpperCase()} ${pathStr}`);
          }
        }
      }

      expect(missing).toEqual([]);
    });

    it("every operation has an operationId", () => {
      const spec = loadSpec();
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const missing: string[] = [];

      for (const [pathStr, methods] of Object.entries(paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
          if (!operation.operationId) {
            missing.push(`${method.toUpperCase()} ${pathStr}`);
          }
        }
      }

      expect(missing).toEqual([]);
    });

    it("all operationIds are unique", () => {
      const spec = loadSpec();
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const ids: string[] = [];

      for (const methods of Object.values(paths)) {
        for (const [method, operation] of Object.entries(methods)) {
          if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
          if (operation.operationId) {
            ids.push(operation.operationId as string);
          }
        }
      }

      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(dupes).toEqual([]);
    });
  });

  describe("schema completeness", () => {
    it("defines all expected component schemas", () => {
      const spec = loadSpec();
      const schemas = Object.keys(
        (spec.components as Record<string, Record<string, unknown>>).schemas
      );

      const expected = [
        "Error",
        "ValidationError",
        "VehicleDTO",
        "VehicleProfile",
        "VehicleType",
        "SimulationStatus",
        "StartOptions",
        "ClockState",
        "DirectionRequest",
        "DirectionResult",
        "Direction",
        "Route",
        "IncidentDTO",
        "IncidentType",
        "CreateIncidentRequest",
        "Fleet",
        "TrafficProfile",
        "TrafficEdge",
        "HeatZoneFeature",
        "POI",
        "Road",
        "SearchResult",
        "RecordingHeader",
        "RecordingMetadata",
        "RecordingFile",
        "ReplayStatus",
        "WaypointRequest",
        "Waypoint",
      ];

      for (const name of expected) {
        expect(schemas).toContain(name);
      }
    });

    it("all $ref targets resolve", async () => {
      // SwaggerParser.dereference will throw if any $ref is broken
      const api = await SwaggerParser.dereference(SPEC_PATH);
      expect(api).toBeDefined();
    });
  });

  describe("status codes", () => {
    it("POST endpoints that create resources use 201", () => {
      const spec = loadSpec();
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      // These endpoints are known to return 201
      const creationEndpoints = [
        "POST /incidents",
        "POST /incidents/random",
        "POST /incidents/at-position",
        "POST /fleets",
      ];

      for (const endpoint of creationEndpoints) {
        const [, ePath] = endpoint.split(" ");
        const specPath = ePath.replace(/:(\w+)/g, "{$1}");
        const operation = (paths[specPath] as Record<string, Record<string, unknown>>)?.post;
        expect(operation?.responses).toHaveProperty("201");
      }
    });

    it("error responses are documented where applicable", () => {
      const spec = loadSpec();
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;

      // Endpoints known to return 400
      const validationEndpoints = [
        { path: "/direction", method: "post", code: "400" },
        { path: "/incidents", method: "post", code: "400" },
        { path: "/incidents/at-position", method: "post", code: "400" },
        { path: "/find-node", method: "post", code: "400" },
        { path: "/find-road", method: "post", code: "400" },
        { path: "/search", method: "post", code: "400" },
        { path: "/clock", method: "post", code: "400" },
      ];

      for (const { path: ePath, method, code } of validationEndpoints) {
        const operation = paths[ePath]?.[method];
        expect(
          operation?.responses,
          `Expected ${method.toUpperCase()} ${ePath} to have ${code} response`
        ).toHaveProperty(code);
      }
    });

    it("DELETE /incidents/{id} documents 404", () => {
      const spec = loadSpec();
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      const operation = paths["/incidents/{id}"]?.delete;
      expect(operation?.responses).toHaveProperty("404");
    });

    it("recording endpoints document 409 conflict", () => {
      const spec = loadSpec();
      const paths = spec.paths as Record<string, Record<string, Record<string, unknown>>>;
      expect(paths["/recording/start"]?.post?.responses).toHaveProperty("409");
      expect(paths["/recording/stop"]?.post?.responses).toHaveProperty("409");
    });
  });
});
