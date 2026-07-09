import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CI_PATH = path.resolve(__dirname, "../../../../.github/workflows/ci.yml");

describe("CI workflow configuration", () => {
  const ciContent = fs.readFileSync(CI_PATH, "utf-8");

  it("CI workflow file exists", () => {
    expect(fs.existsSync(CI_PATH)).toBe(true);
  });

  it("contains the required job names", () => {
    const requiredJobs = ["verify", "format-check", "security-audit"];
    for (const job of requiredJobs) {
      expect(ciContent).toContain(`  ${job}:`);
    }
  });

  it("verify job runs Biome lint, then type-check, test and build through turbo", () => {
    // Biome (lint + format) is a single fast pass over the whole repo, so it
    // runs at the root via `npm run lint` rather than fanning out through turbo.
    expect(ciContent).toContain("npm run lint");
    expect(ciContent).toContain("npx turbo type-check test:ci build");
  });

  it("format-check job runs npm run format:check", () => {
    const formatCheckBlock = ciContent.slice(
      ciContent.indexOf("  format-check:"),
      ciContent.indexOf("\n\n", ciContent.indexOf("  format-check:"))
    );
    expect(formatCheckBlock).toContain("npm run format:check");
  });

  it("every job installs deps with npm ci (no cache-miss-without-install)", () => {
    const jobs = ["verify", "format-check", "security-audit"];
    for (const job of jobs) {
      const jobStart = ciContent.indexOf(`  ${job}:`);
      expect(jobStart).toBeGreaterThan(-1);
      const end = ciContent.indexOf("\n\n", jobStart);
      const jobBlock = ciContent.slice(jobStart, end === -1 ? ciContent.length : end);
      expect(jobBlock).toContain("npm ci");
    }
  });

  it("pins a single node version via the NODE_VERSION env", () => {
    expect(ciContent).toMatch(/NODE_VERSION:\s*\S+/);
    // Every job references the same pinned version, not a hardcoded literal.
    const nodeVersionRefs = ciContent.match(/node-version:\s*(\S+)/g) ?? [];
    expect(nodeVersionRefs.length).toBeGreaterThan(0);
    const unique = [...new Set(nodeVersionRefs.map((m) => m.replace("node-version:", "").trim()))];
    expect(unique).toHaveLength(1);
  });

  it("all jobs use actions/checkout@v7", () => {
    const checkoutMatches = ciContent.match(/uses:\s*actions\/checkout@v\d+/g);
    expect(checkoutMatches).not.toBeNull();
    for (const match of checkoutMatches!) {
      expect(match).toContain("actions/checkout@v7");
    }
  });
});
