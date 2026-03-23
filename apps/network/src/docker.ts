import { execSync } from "child_process";
import path from "path";

const OSMIUM_IMAGE = "ghcr.io/osmcode/osmium-tool:v1.16.0";

function hasLocalOsmium(): boolean {
  try {
    execSync("osmium version", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function buildOsmiumCommand(args: string[], workdir: string): string {
  if (hasLocalOsmium()) {
    const absWorkdir = path.resolve(workdir);
    return `osmium ${args.map((a) => (a.includes("/") ? `${absWorkdir}/${a}` : a)).join(" ")}`;
  }
  const absWorkdir = path.resolve(workdir);
  return `docker run --rm -v ${absWorkdir}:/data ${OSMIUM_IMAGE} osmium ${args.join(" ")}`;
}

export function osmium(args: string[], workdir: string): void {
  if (hasLocalOsmium()) {
    const absWorkdir = path.resolve(workdir);
    const resolvedArgs = args.map((a) =>
      a.endsWith(".osm.pbf") || a.endsWith(".geojson") || a.endsWith(".json")
        ? path.join(absWorkdir, a)
        : a,
    );
    execSync(`osmium ${resolvedArgs.join(" ")}`, { stdio: "inherit" });
    return;
  }
  const absWorkdir = path.resolve(workdir);
  const cmd = `docker run --rm -v ${absWorkdir}:/data ${OSMIUM_IMAGE} osmium ${args.join(" ")}`;
  execSync(cmd, { stdio: "inherit" });
}

export function checkDockerAvailable(): void {
  if (hasLocalOsmium()) return;
  try {
    execSync("docker --version", { stdio: "pipe" });
  } catch {
    throw new Error(
      "osmium-tool is not available. Install it with:\n" +
        "  macOS: brew install osmium-tool\n" +
        "  Linux: apt install osmium-tool\n" +
        "Or install Docker: https://docs.docker.com/get-docker/",
    );
  }
}
