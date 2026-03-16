import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");

function readJSON(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), "utf-8"));
}

describe("ESM module configuration", () => {
  const tsconfig = readJSON("tsconfig.json") as {
    compilerOptions: Record<string, string>;
  };
  const pkg = readJSON("package.json") as Record<string, string>;

  it("package.json declares ESM via type: module", () => {
    expect(pkg.type).toBe("module");
  });

  it("tsconfig module is ESNext (not CommonJS)", () => {
    const mod = tsconfig.compilerOptions.module;
    expect(mod).toMatch(/^(ESNext|ES2022|Node16|NodeNext)$/i);
    expect(mod.toLowerCase()).not.toBe("commonjs");
  });

  it("tsconfig moduleResolution is set and compatible with ESM", () => {
    const res = tsconfig.compilerOptions.moduleResolution;
    expect(res).toBeDefined();
    expect(res).toMatch(/^(bundler|node16|nodenext)$/i);
  });

  it("tsconfig module and package.json type are aligned for ESM", () => {
    // If package.json says "module", tsconfig should not emit CJS
    expect(pkg.type).toBe("module");
    expect(tsconfig.compilerOptions.module.toLowerCase()).not.toBe("commonjs");
  });

  it("key adapter modules can be imported", async () => {
    // Verify that cross-module imports resolve correctly under ESM
    const { PluginManager } = await import("../plugins/manager");
    expect(PluginManager).toBeDefined();
    expect(typeof PluginManager).toBe("function");

    const types = await import("../types");
    expect(types.MedicalType).toBeDefined();
    expect(types.VehicleTrackingTypes).toBeDefined();

    const { loadConfig } = await import("../utils/config");
    expect(typeof loadConfig).toBe("function");

    const { redactConfig } = await import("../utils/redact");
    expect(typeof redactConfig).toBe("function");
  });
});
