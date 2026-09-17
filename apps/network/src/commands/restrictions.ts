import fs from "fs";
import path from "path";
import type { Feature, FeatureCollection, Point } from "geojson";
import { osmium, osmiumOutput } from "../docker.js";

/**
 * OSM turn restrictions (`type=restriction` relations) for the simulator.
 *
 * `osmium export` writes only node/way geometries, so relations never reach the
 * GeoJSON. This step pulls them out of the filtered PBF on their own (with the
 * objects they reference, for the via-node coordinates), reads them as OPL, and
 * emits one Point feature per restriction at its via node:
 *
 *   { type: "restriction", restriction: "no_left_turn", from: <way id>, to: <way id>, ... }
 *
 * All relation tags are copied verbatim (`restriction:motorcar`, `except`,
 * `restriction:conditional`, ...); deciding which ones bind a car is the
 * simulator's job (`pathfinding/turns.ts`). The simulator matches `from`/`to`
 * against each way's `@id` (see `buildExportArgs`) and snaps the Point to the
 * via node.
 *
 * Not supported, skipped and counted: via-WAY restrictions, and relations with
 * more or fewer than exactly one from way, one to way and one via node.
 */

export interface RestrictionExtract {
  features: Feature<Point>[];
  skipped: { viaWay: number; missingViaNode: number; ambiguous: number };
}

export function buildRestrictionFilterArgs(opts: { input: string; output: string }): string[] {
  return [
    "tags-filter",
    path.basename(opts.input),
    "r/type=restriction",
    "-o",
    path.basename(opts.output),
    "--overwrite",
  ];
}

export function buildRestrictionOplArgs(input: string): string[] {
  return ["cat", path.basename(input), "-f", "opl"];
}

/** OPL escapes special characters as `%<hex codepoint>%`. */
function unescapeOpl(value: string): string {
  return value.replace(/%([0-9a-fA-F]+)%/g, (_, hex: string) =>
    String.fromCodePoint(parseInt(hex, 16))
  );
}

/** Splits an OPL line into its `<letter><value>` fields. */
function oplFields(line: string): Map<string, string> {
  const fields = new Map<string, string>();
  const tokens = line.split(" ");
  fields.set("id", tokens[0]);
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i].length > 0) fields.set(tokens[i][0], tokens[i].slice(1));
  }
  return fields;
}

function parseTags(raw: string | undefined): Record<string, string> {
  const tags: Record<string, string> = {};
  if (!raw) return tags;
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    tags[unescapeOpl(pair.slice(0, eq))] = unescapeOpl(pair.slice(eq + 1));
  }
  return tags;
}

/** Parses `osmium cat -f opl` output of a restrictions extract into via-node Point features. */
export function parseRestrictionsOpl(opl: string): RestrictionExtract {
  const nodes = new Map<string, [number, number]>();
  const relations: Map<string, string>[] = [];

  for (const line of opl.split("\n")) {
    if (line.startsWith("n")) {
      const f = oplFields(line);
      const x = Number(f.get("x"));
      const y = Number(f.get("y"));
      if (f.get("x") && f.get("y") && Number.isFinite(x) && Number.isFinite(y)) {
        nodes.set(f.get("id")!.slice(1), [x, y]);
      }
    } else if (line.startsWith("r")) {
      relations.push(oplFields(line));
    }
  }

  const result: RestrictionExtract = {
    features: [],
    skipped: { viaWay: 0, missingViaNode: 0, ambiguous: 0 },
  };

  for (const rel of relations) {
    const from: string[] = [];
    const to: string[] = [];
    const viaNodes: string[] = [];
    let viaWay = false;
    for (const member of (rel.get("M") ?? "").split(",")) {
      const at = member.indexOf("@");
      if (at <= 1) continue;
      const kind = member[0];
      const ref = member.slice(1, at);
      const role = unescapeOpl(member.slice(at + 1));
      if (role === "from" && kind === "w") from.push(ref);
      else if (role === "to" && kind === "w") to.push(ref);
      else if (role === "via" && kind === "n") viaNodes.push(ref);
      else if (role === "via" && kind === "w") viaWay = true;
    }

    if (viaWay) {
      result.skipped.viaWay++;
      continue;
    }
    if (from.length !== 1 || to.length !== 1 || viaNodes.length !== 1) {
      result.skipped.ambiguous++;
      continue;
    }
    const coordinate = nodes.get(viaNodes[0]);
    if (!coordinate) {
      result.skipped.missingViaNode++;
      continue;
    }

    result.features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: coordinate },
      properties: {
        "@id": Number(rel.get("id")!.slice(1)),
        ...parseTags(rel.get("T")),
        from: Number(from[0]),
        to: Number(to[0]),
      },
    });
  }

  return result;
}

/** Returns `fc` with the restriction features appended after its own features. */
export function appendRestrictions(
  fc: FeatureCollection,
  restrictions: Feature<Point>[]
): FeatureCollection {
  return { ...fc, features: [...fc.features, ...restrictions] };
}

/**
 * Extracts the restriction relations of a (filtered) PBF as via-node Point
 * features. Writes a small `<input>-restrictions.osm.pbf` next to the input.
 */
export function extractRestrictions(input: string): RestrictionExtract {
  const workdir = path.dirname(input);
  const output = path.join(workdir, `${path.basename(input, ".osm.pbf")}-restrictions.osm.pbf`);
  osmium(buildRestrictionFilterArgs({ input, output }), workdir);
  try {
    return parseRestrictionsOpl(osmiumOutput(buildRestrictionOplArgs(output), workdir));
  } finally {
    fs.rmSync(output, { force: true });
  }
}
