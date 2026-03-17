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
    const requiredJobs = ["setup", "format-check", "lint", "test", "build"];
    for (const job of requiredJobs) {
      expect(ciContent).toContain(`  ${job}:`);
    }
  });

  it("format-check job depends on setup", () => {
    const formatCheckBlock = ciContent.slice(
      ciContent.indexOf("  format-check:"),
      ciContent.indexOf("\n\n", ciContent.indexOf("  format-check:"))
    );
    expect(formatCheckBlock).toContain("needs: setup");
  });

  it("format-check job runs npm run format:check", () => {
    const formatCheckBlock = ciContent.slice(
      ciContent.indexOf("  format-check:"),
      ciContent.indexOf("\n\n", ciContent.indexOf("  format-check:"))
    );
    expect(formatCheckBlock).toContain("npm run format:check");
  });

  it("format-check runs in parallel with lint, test, and build (all depend only on setup)", () => {
    // Extract the needs line for each parallel job
    const parallelJobs = ["format-check", "lint", "test", "build"];
    for (const job of parallelJobs) {
      const jobStart = ciContent.indexOf(`  ${job}:`);
      expect(jobStart).toBeGreaterThan(-1);
      const jobBlock = ciContent.slice(
        jobStart,
        ciContent.indexOf("\n\n", jobStart) === -1
          ? ciContent.length
          : ciContent.indexOf("\n\n", jobStart)
      );
      expect(jobBlock).toContain("needs: setup");
    }
  });

  it("all jobs use the same node version", () => {
    const nodeVersionMatches = ciContent.match(/node-version:\s*(\S+)/g);
    expect(nodeVersionMatches).not.toBeNull();
    const versions = nodeVersionMatches!.map((m) => m.replace("node-version:", "").trim());
    const unique = [...new Set(versions)];
    expect(unique).toHaveLength(1);
  });

  it("all jobs use actions/checkout@v4", () => {
    const checkoutMatches = ciContent.match(/uses:\s*actions\/checkout@v\d+/g);
    expect(checkoutMatches).not.toBeNull();
    for (const match of checkoutMatches!) {
      expect(match).toContain("actions/checkout@v4");
    }
  });
});
