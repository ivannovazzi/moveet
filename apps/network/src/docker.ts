import { execSync } from "child_process";
import path from "path";

const OSMIUM_IMAGE = "osmcode/osmium-tool";

export function buildOsmiumCommand(args: string[], workdir: string): string {
  const absWorkdir = path.resolve(workdir);
  return `docker run --rm -v ${absWorkdir}:/data ${OSMIUM_IMAGE} osmium ${args.join(" ")}`;
}

export function osmium(args: string[], workdir: string): void {
  const cmd = buildOsmiumCommand(args, workdir);
  execSync(cmd, { stdio: "inherit" });
}

export function checkDockerAvailable(): void {
  try {
    execSync("docker --version", { stdio: "pipe" });
  } catch {
    throw new Error(
      "Docker is not available. Please install Docker and ensure it is running.\n" +
        "See: https://docs.docker.com/get-docker/"
    );
  }
}
