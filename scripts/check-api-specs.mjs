#!/usr/bin/env node
// ─── API specification drift check ──────────────────────────────────
//
// Both simulator API specs are hand-maintained, so nothing stops them from
// silently falling behind the code. This script is the thing that stops it:
//
//   1. apps/simulator/openapi.yaml must describe exactly the routes the
//      Express app registers — no undocumented route, no phantom path.
//   2. apps/simulator/asyncapi.yaml must describe exactly the WebSocket
//      message types declared in packages/shared-types/src/ws.ts, which is
//      the single source of truth for the WS contract.
//   3. Both specs must be stamped with the simulator package version.
//
// Any mismatch prints the offending entries and exits non-zero, so CI fails
// on drift instead of letting the specs rot.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const simulatorDir = path.join(repoRoot, "apps", "simulator");
const OPENAPI_PATH = path.join(simulatorDir, "openapi.yaml");
const ASYNCAPI_PATH = path.join(simulatorDir, "asyncapi.yaml");
const WS_TYPES_PATH = path.join(repoRoot, "packages", "shared-types", "src", "ws.ts");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];

/**
 * Infrastructure routes served straight from index.ts that are deliberately
 * absent from the OpenAPI document: the health probe, the raw spec download,
 * the Scalar docs UI and the Prometheus scrape endpoint.
 */
const UNDOCUMENTED_INFRA_ROUTES = new Set(["GET /health", "GET /api-docs.yaml", "GET /metrics"]);

/** Inbound (client -> server) WS message types, not part of WsMessageMap. */
const INBOUND_WS_TYPES = new Set(["subscribe"]);

const failures = [];

function fail(message, entries = []) {
  failures.push({ message, entries });
}

function readYaml(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Spec not found: ${path.relative(repoRoot, filePath)}`);
  }
  return YAML.parse(fs.readFileSync(filePath, "utf-8"));
}

function diff(actual, expected) {
  return {
    missing: [...expected].filter((x) => !actual.has(x)).sort(),
    extra: [...actual].filter((x) => !expected.has(x)).sort(),
  };
}

// ─── REST: routes the Express app actually registers ────────────────

/**
 * Collects `METHOD /path` for every route handler registered in index.ts or
 * any file under src/routes. Route modules are mounted with `app.use(router)`
 * and therefore carry no path prefix, so the literal passed to `.get(...)` &c
 * is the full path.
 */
function extractRoutesFromSource() {
  const routesDir = path.join(simulatorDir, "src", "routes");
  const files = [
    path.join(simulatorDir, "src", "index.ts"),
    ...fs.readdirSync(routesDir).map((f) => path.join(routesDir, f)),
  ].filter((f) => f.endsWith(".ts"));

  const routeRegex = /\.(get|post|put|patch|delete)\(\s*["'`]([^"'`]+)["'`]/g;
  const routes = new Set();

  for (const file of files) {
    const source = fs.readFileSync(file, "utf-8");
    for (const match of source.matchAll(routeRegex)) {
      const key = `${match[1].toUpperCase()} ${match[2]}`;
      if (!UNDOCUMENTED_INFRA_ROUTES.has(key)) routes.add(key);
    }
  }
  return routes;
}

/** Collects `METHOD /path` from the OpenAPI document, in Express notation. */
function extractRoutesFromOpenApi(spec) {
  const routes = new Set();
  for (const [pathStr, operations] of Object.entries(spec.paths ?? {})) {
    for (const method of Object.keys(operations)) {
      if (!HTTP_METHODS.includes(method)) continue;
      routes.add(`${method.toUpperCase()} ${pathStr.replace(/\{(\w+)\}/g, ":$1")}`);
    }
  }
  return routes;
}

// ─── WS: the message union declared in shared-types ─────────────────

/** Returns the text between the first balanced `open`/`close` pair after `header`. */
function sliceBlock(source, header, open = "{", close = "}") {
  const start = source.indexOf(header);
  if (start === -1) throw new Error(`Could not find \`${header}\` in ws.ts`);
  const from = source.indexOf(open, start);
  if (from === -1) throw new Error(`No \`${open}\` after \`${header}\` in ws.ts`);
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close && --depth === 0) return source.slice(from + 1, i);
  }
  throw new Error(`Unterminated block for \`${header}\` in ws.ts`);
}

/** Property keys of the `WsMessageMap` interface — the data-carrying types. */
function extractDataMessageTypes(source) {
  const body = sliceBlock(source, "export interface WsMessageMap");
  const types = new Set();
  for (const line of body.split("\n")) {
    const match = line.match(/^\s*"?([A-Za-z][\w:-]*)"?\s*:/);
    if (match) types.add(match[1]);
  }
  return types;
}

/** The runtime `DATA_MESSAGE_TYPES` set literal, used to cross-check the map. */
function extractRuntimeMessageTypes(source) {
  const body = sliceBlock(source, "const DATA_MESSAGE_TYPES", "[", "]");
  return new Set([...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/** The `WsControlMessageType` union members (`connect` / `disconnect`). */
function extractControlMessageTypes(source) {
  const match = source.match(/export type WsControlMessageType\s*=([^;]+);/);
  if (!match) throw new Error("Could not find `WsControlMessageType` in ws.ts");
  return new Set([...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
}

/**
 * The wire `type` of an AsyncAPI message, read from the const-discriminated
 * `type` property of its payload rather than from the component key, so the
 * check is against what a client would actually see on the wire.
 */
function messageWireType(spec, ref) {
  const key = ref.replace("#/components/messages/", "");
  const message = spec.components?.messages?.[key];
  if (!message) throw new Error(`AsyncAPI operation references unknown message: ${ref}`);
  const wireType = message.payload?.properties?.type?.const;
  if (typeof wireType !== "string") {
    throw new Error(`AsyncAPI message \`${key}\` has no payload.properties.type.const`);
  }
  return { key, wireType, message };
}

function operationMessageTypes(spec, operationName) {
  const operation = spec.operations?.[operationName];
  if (!operation) throw new Error(`AsyncAPI operation \`${operationName}\` is missing`);
  return (operation.messages ?? []).map((m) => messageWireType(spec, m.$ref));
}

// ─── Checks ─────────────────────────────────────────────────────────

function checkOpenApi(openapi, expectedVersion) {
  const sourceRoutes = extractRoutesFromSource();
  const specRoutes = extractRoutesFromOpenApi(openapi);
  const { missing, extra } = diff(specRoutes, sourceRoutes);

  if (missing.length) fail("Routes implemented but missing from openapi.yaml", missing);
  if (extra.length) fail("Paths in openapi.yaml with no matching Express route", extra);

  if (openapi.info?.version !== expectedVersion) {
    fail(
      `openapi.yaml info.version is "${openapi.info?.version}" but @moveet/simulator is at "${expectedVersion}"`
    );
  }

  for (const [pathStr, operations] of Object.entries(openapi.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!HTTP_METHODS.includes(method)) continue;
      if (!operation.operationId) {
        fail(`Operation without an operationId: ${method.toUpperCase()} ${pathStr}`);
      }
      if (!operation.responses || !Object.keys(operation.responses).length) {
        fail(`Operation without responses: ${method.toUpperCase()} ${pathStr}`);
      }
    }
  }
  return sourceRoutes.size;
}

/**
 * Walks a document collecting every `$ref`, so the AsyncAPI document's own
 * schemas and its cross-file references into openapi.yaml can be resolved.
 */
function collectRefs(node, acc = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectRefs(item, acc);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === "$ref" && typeof value === "string") acc.push(value);
      else collectRefs(value, acc);
    }
  }
  return acc;
}

function resolvePointer(doc, pointer) {
  return pointer
    .split("/")
    .slice(1)
    .reduce((node, segment) => node?.[segment.replace(/~1/g, "/").replace(/~0/g, "~")], doc);
}

/** Fails for any `$ref` in the AsyncAPI document that does not resolve. */
function checkAsyncApiRefs(asyncapi, openapi) {
  for (const ref of new Set(collectRefs(asyncapi))) {
    const [file, pointer] = ref.split("#");
    if (file && file !== "./openapi.yaml") {
      fail(`asyncapi.yaml references an unknown document: ${ref}`);
      continue;
    }
    const target = file ? openapi : asyncapi;
    if (resolvePointer(target, pointer) === undefined) {
      fail(`Unresolvable $ref in asyncapi.yaml: ${ref}`);
    }
  }
}

function checkAsyncApi(asyncapi, expectedVersion) {
  const wsSource = fs.readFileSync(WS_TYPES_PATH, "utf-8");
  const dataTypes = extractDataMessageTypes(wsSource);
  const runtimeTypes = extractRuntimeMessageTypes(wsSource);
  const controlTypes = extractControlMessageTypes(wsSource);

  // ws.ts internal consistency: the runtime validator set must match the
  // compile-time map, or `isValidMessage` silently rejects valid frames.
  const runtimeDrift = diff(runtimeTypes, dataTypes);
  if (runtimeDrift.missing.length) {
    fail("WsMessageMap keys absent from the DATA_MESSAGE_TYPES runtime set", runtimeDrift.missing);
  }
  if (runtimeDrift.extra.length) {
    fail("DATA_MESSAGE_TYPES entries absent from WsMessageMap", runtimeDrift.extra);
  }

  const expectedOutbound = new Set([...dataTypes, ...controlTypes]);
  const outbound = operationMessageTypes(asyncapi, "receiveSimulationEvents");
  const outboundTypes = new Set(outbound.map((m) => m.wireType));
  const outboundDrift = diff(outboundTypes, expectedOutbound);

  if (outboundDrift.missing.length) {
    fail("WS message types in shared-types but missing from asyncapi.yaml", outboundDrift.missing);
  }
  if (outboundDrift.extra.length) {
    fail("Messages in asyncapi.yaml with no type in shared-types", outboundDrift.extra);
  }

  // Data-carrying frames must document a `data` payload; control frames must not.
  for (const { key, wireType, message } of outbound) {
    const hasData = Boolean(message.payload?.properties?.data);
    if (dataTypes.has(wireType) && !hasData) {
      fail(
        `AsyncAPI message \`${key}\` carries data in shared-types but documents no payload.data`
      );
    }
    if (controlTypes.has(wireType) && hasData) {
      fail(`AsyncAPI message \`${key}\` is a control frame but documents a payload.data`);
    }
  }

  const inbound = operationMessageTypes(asyncapi, "sendClientCommands");
  const inboundDrift = diff(new Set(inbound.map((m) => m.wireType)), INBOUND_WS_TYPES);
  if (inboundDrift.missing.length) {
    fail("Inbound WS message types missing from asyncapi.yaml", inboundDrift.missing);
  }
  if (inboundDrift.extra.length) {
    fail("Inbound messages in asyncapi.yaml the server does not handle", inboundDrift.extra);
  }

  if (asyncapi.info?.version !== expectedVersion) {
    fail(
      `asyncapi.yaml info.version is "${asyncapi.info?.version}" but @moveet/simulator is at "${expectedVersion}"`
    );
  }
  return outboundTypes.size;
}

// ─── Entry point ────────────────────────────────────────────────────

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(simulatorDir, "package.json"), "utf-8"));
  const openapi = readYaml(OPENAPI_PATH);
  const asyncapi = readYaml(ASYNCAPI_PATH);

  const routeCount = checkOpenApi(openapi, pkg.version);
  const messageCount = checkAsyncApi(asyncapi, pkg.version);
  checkAsyncApiRefs(asyncapi, openapi);

  if (failures.length) {
    console.error("API spec drift detected:\n");
    for (const { message, entries } of failures) {
      console.error(`  ✗ ${message}`);
      for (const entry of entries) console.error(`      - ${entry}`);
    }
    console.error(
      "\nUpdate apps/simulator/openapi.yaml / apps/simulator/asyncapi.yaml to match the code."
    );
    process.exit(1);
  }

  console.log(
    `API specs match the code: ${routeCount} REST routes, ${messageCount} WebSocket message types.`
  );
}

try {
  main();
} catch (err) {
  console.error(`API spec check failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
