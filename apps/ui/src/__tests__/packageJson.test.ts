import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("package.json", () => {
  const pkgPath = resolve(__dirname, "../../package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  it("should not have a packageManager field referencing yarn", () => {
    if (pkg.packageManager) {
      expect(pkg.packageManager).not.toMatch(/yarn/i);
    }
  });

  it("should not have any scripts referencing yarn", () => {
    const scripts = pkg.scripts ?? {};
    for (const [name, cmd] of Object.entries(scripts)) {
      expect(cmd, `script "${name}" should not reference yarn`).not.toMatch(/\byarn\b/);
    }
  });

  it("should use npm-compatible script names", () => {
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts.dev).toBeDefined();
    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.test).toBeDefined();
  });
});
