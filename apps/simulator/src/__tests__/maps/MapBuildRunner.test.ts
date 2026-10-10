import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createForkRunner,
  MapBuildCancelledError,
  resolveChildScript,
  type BuildProgress,
  type MapBuildChildRequest,
} from "../../modules/maps/MapBuildRunner";

const FAKE_CHILD = path.join(__dirname, "..", "fixtures", "fake-map-build-child.mjs");

const tmpDirs: string[] = [];
function request(geofabrik: string): MapBuildChildRequest {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "moveet-runner-"));
  tmpDirs.push(dir);
  return {
    geofabrik,
    bbox: [0, 0, 1, 1],
    cacheDir: dir,
    workDir: dir,
    outDir: dir,
    regionName: "test",
  };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("createForkRunner", () => {
  const run = createForkRunner(FAKE_CHILD);

  it("relays progress and resolves with the child's result", async () => {
    const progress: BuildProgress[] = [];
    const handle = run(request("ok"), (p) => progress.push(p));
    await expect(handle.result).resolves.toMatchObject({ featureCount: 7 });
    expect(progress).toEqual([{ step: "download", progress: 0.5 }]);
  });

  it("rejects with the error the child reports", async () => {
    await expect(run(request("error"), () => {}).result).rejects.toThrow("osmium failed");
  });

  it("rejects when the child dies, quoting its last output", async () => {
    await expect(run(request("crash"), () => {}).result).rejects.toThrow(
      /exited \(code 3\).*something went badly wrong/
    );
  });

  it("cancel kills the child's whole process group", async () => {
    const req = request("hang");
    const progress: BuildProgress[] = [];
    const handle = run(req, (p) => progress.push(p));
    const pidFile = path.join(req.outDir, "grandchild.pid");
    await waitFor(() => fs.existsSync(pidFile) && progress.length > 0);
    const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
    expect(alive(grandchild)).toBe(true);

    handle.cancel();
    await expect(handle.result).rejects.toBeInstanceOf(MapBuildCancelledError);
    await waitFor(() => !alive(grandchild));
  });

  it("resolves the bundled child script path", () => {
    expect(resolveChildScript()).toMatch(/dist[\\/]workers[\\/]map-build-child\.mjs$/);
  });
});
