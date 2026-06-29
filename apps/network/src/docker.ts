import { execFileSync } from "child_process";
import path from "path";

let osmiumAvailable: boolean | undefined;

function hasLocalOsmium(): boolean {
  if (osmiumAvailable !== undefined) return osmiumAvailable;
  try {
    execFileSync("osmium", ["version"], { stdio: "pipe" });
    osmiumAvailable = true;
  } catch {
    osmiumAvailable = false;
  }
  return osmiumAvailable;
}

/**
 * Build the osmium argument array for a given workdir. File arguments (those
 * ending in a known extension) are resolved relative to the workdir; flags and
 * values are passed through unchanged. Returned as an array so callers invoke
 * osmium without a shell (no injection, paths with spaces are safe).
 */
export function buildOsmiumArgs(args: string[], workdir: string): string[] {
  const absWorkdir = path.resolve(workdir);
  return args.map((a) =>
    a.endsWith(".osm.pbf") || a.endsWith(".geojson") || a.endsWith(".json")
      ? path.join(absWorkdir, a)
      : a
  );
}

export function osmium(args: string[], workdir: string): void {
  execFileSync("osmium", buildOsmiumArgs(args, workdir), { stdio: "inherit" });
}

export function checkOsmiumAvailable(): void {
  if (hasLocalOsmium()) return;
  throw new Error(
    "osmium-tool is not available. Install it with:\n" +
      "  macOS: brew install osmium-tool\n" +
      "  Linux: apt install osmium-tool\n" +
      "See https://osmcode.org/osmium-tool/"
  );
}
