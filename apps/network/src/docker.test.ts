import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { execSync } from "child_process";
import { buildOsmiumCommand, checkDockerAvailable } from "./docker.js";

const mockExec = vi.mocked(execSync);

beforeEach(() => {
  mockExec.mockReset();
});

describe("buildOsmiumCommand", () => {
  it("builds docker run command with correct volume mount", () => {
    const cmd = buildOsmiumCommand(
      ["extract", "--bbox", "1,2,3,4", "input.osm.pbf", "-o", "out.osm.pbf"],
      "/abs/workdir",
    );
    expect(cmd).toContain("docker run --rm");
    expect(cmd).toContain("-v /abs/workdir:/data");
    expect(cmd).toContain("ghcr.io/osmcode/osmium-tool");
    expect(cmd).toContain(
      "osmium extract --bbox 1,2,3,4 input.osm.pbf -o out.osm.pbf",
    );
  });
});

describe("checkDockerAvailable", () => {
  it("does not throw when docker is available", () => {
    mockExec.mockReturnValue(Buffer.from("Docker version 24.0.0"));
    expect(() => checkDockerAvailable()).not.toThrow();
  });

  it("throws a clear error when docker is not available", () => {
    mockExec.mockImplementation(() => {
      throw new Error("command not found: docker");
    });
    expect(() => checkDockerAvailable()).toThrow(/docker is not available/i);
  });
});
