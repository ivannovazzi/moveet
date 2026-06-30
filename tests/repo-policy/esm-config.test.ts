import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// ─── Repo-policy: ESM module configuration ──────────────────────────
//
// These assertions used to live in apps/adapter/src/__tests__/module-
// resolution.test.ts. They read repo infrastructure (tsconfig / package.json),
// so a legitimate CI/build refactor would redden the ADAPTER app suite even
// though no adapter code changed. They are repo-wide policy, not an adapter
// unit concern, so they live here and run via `npm run test:repo` (a CI step
// of its own). They assert PARSED STRUCTURE rather than brittle exact strings.

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

/**
 * Parse a (possibly JSONC) config file. tsconfig files are JSON-with-comments:
 * they allow `//` / block comments and trailing commas, which `JSON.parse`
 * rejects. Strip those (string-literal aware) before parsing so the policy can
 * read the UI's tsconfig.app.json as well as the strict-JSON package.json files.
 */
function readJSONC(path: string): Record<string, unknown> {
  const raw = readFileSync(path, "utf-8");
  let out = "";
  let inString = false;
  let stringQuote = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inString) {
      out += ch;
      if (ch === "\\") {
        out += next ?? "";
        i++;
      } else if (ch === stringQuote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      stringQuote = ch;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (i < raw.length && raw[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < raw.length && !(raw[i] === "*" && raw[i + 1] === "/")) i++;
      i++; // skip the closing slash
      continue;
    }
    out += ch;
  }
  // Drop trailing commas before } or ].
  out = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(out);
}

function readJSON(path: string): Record<string, unknown> {
  return readJSONC(path);
}

/**
 * Resolve the effective `compilerOptions` for a tsconfig, following a single
 * `extends` chain (the app tsconfigs extend the monorepo's tsconfig.base.json).
 * Returns the merged base + local options.
 */
function readEffectiveCompilerOptions(tsconfigPath: string): Record<string, string> {
  const local = readJSON(tsconfigPath) as {
    extends?: string;
    compilerOptions?: Record<string, string>;
  };
  let base: Record<string, string> = {};
  if (local.extends) {
    const basePath = resolve(dirname(tsconfigPath), local.extends);
    base = (readJSON(basePath).compilerOptions as Record<string, string>) ?? {};
  }
  return { ...base, ...(local.compilerOptions ?? {}) };
}

// Workspace apps that ship runnable TS. The UI uses project references
// (tsconfig.app.json) instead of a root compilerOptions block, so it resolves
// its effective options from there.
const APPS = [
  { name: "simulator", dir: "apps/simulator", tsconfig: "tsconfig.json" },
  { name: "adapter", dir: "apps/adapter", tsconfig: "tsconfig.json" },
  { name: "network", dir: "apps/network", tsconfig: "tsconfig.json" },
  { name: "ui", dir: "apps/ui", tsconfig: "tsconfig.app.json" },
];

describe("repo policy: shared tsconfig base is ESM-compatible", () => {
  const baseOptions = readEffectiveCompilerOptions(resolve(repoRoot, "tsconfig.base.json"));

  it("tsconfig.base.json module is ESM (not CommonJS)", () => {
    const mod = baseOptions.module;
    expect(mod).toBeDefined();
    expect(mod).toMatch(/^(ESNext|ES2022|Node16|NodeNext)$/i);
    expect(mod.toLowerCase()).not.toBe("commonjs");
  });

  it("tsconfig.base.json moduleResolution is set and ESM-compatible", () => {
    const res = baseOptions.moduleResolution;
    expect(res).toBeDefined();
    expect(res).toMatch(/^(bundler|node16|nodenext)$/i);
  });
});

describe("repo policy: every workspace app is ESM-aligned", () => {
  for (const app of APPS) {
    describe(app.name, () => {
      const pkgPath = resolve(repoRoot, app.dir, "package.json");
      const tsconfigPath = resolve(repoRoot, app.dir, app.tsconfig);

      it("declares ESM via package.json type: module", () => {
        const pkg = readJSON(pkgPath);
        expect(pkg.type).toBe("module");
      });

      it("its tsconfig resolves to an ESM (non-CJS) module setting", () => {
        expect(existsSync(tsconfigPath)).toBe(true);
        const opts = readEffectiveCompilerOptions(tsconfigPath);
        expect(opts.module).toBeDefined();
        expect(opts.module.toLowerCase()).not.toBe("commonjs");
      });
    });
  }
});

describe("repo policy: workspace layout", () => {
  it("root package.json declares the apps/* and packages/* workspaces", () => {
    const root = readJSON(resolve(repoRoot, "package.json")) as { workspaces?: string[] };
    expect(Array.isArray(root.workspaces)).toBe(true);
    expect(root.workspaces).toEqual(expect.arrayContaining(["apps/*", "packages/*"]));
  });

  it("every declared app actually exists on disk", () => {
    for (const app of APPS) {
      expect(existsSync(join(repoRoot, app.dir, "package.json"))).toBe(true);
    }
  });
});
