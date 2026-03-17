import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

/**
 * Integration tests that verify each app's ESLint config correctly imports
 * and extends the shared @moveet/eslint-config package.
 */

const ROOT = resolve(import.meta.dirname, "../..");

async function loadAppConfig(appPath) {
  const configPath = resolve(ROOT, appPath);
  const configUrl = pathToFileURL(configPath).href;
  const mod = await import(configUrl);
  return mod.default;
}

describe("app ESLint config integration", () => {
  describe("simulator", () => {
    let config;

    it("should load without errors", async () => {
      config = await loadAppConfig("apps/simulator/eslint.config.mjs");
      assert.ok(Array.isArray(config), "config should be an array");
    });

    it("should include the shared ignores block", () => {
      const ignoresBlock = config.find(
        (block) => block.ignores && block.ignores.includes("dist")
      );
      assert.ok(ignoresBlock, "should have a block ignoring dist/");
    });

    it("should include shared no-explicit-any rule", () => {
      const blockWithRule = config.find(
        (block) =>
          block.rules &&
          block.rules["@typescript-eslint/no-explicit-any"] !== undefined
      );
      assert.ok(blockWithRule, "should have a block with no-explicit-any rule");
    });

    it("should include simulator-specific no-require-imports override", () => {
      const blockWithRule = config.find(
        (block) =>
          block.rules &&
          block.rules["@typescript-eslint/no-require-imports"] === "off"
      );
      assert.ok(
        blockWithRule,
        "should have a block with no-require-imports off"
      );
    });

    it("should include test overrides", () => {
      const testBlock = config.find(
        (block) =>
          block.files &&
          block.files.some((f) => f.includes("test")) &&
          block.rules &&
          block.rules["@typescript-eslint/no-explicit-any"] === "off"
      );
      assert.ok(testBlock, "should have test overrides disabling no-explicit-any");
    });
  });

  describe("adapter", () => {
    let config;

    it("should load without errors", async () => {
      config = await loadAppConfig("apps/adapter/eslint.config.mjs");
      assert.ok(Array.isArray(config), "config should be an array");
    });

    it("should include the shared ignores block", () => {
      const ignoresBlock = config.find(
        (block) => block.ignores && block.ignores.includes("dist")
      );
      assert.ok(ignoresBlock, "should have a block ignoring dist/");
    });

    it("should include shared rules", () => {
      const blockWithRule = config.find(
        (block) =>
          block.rules &&
          block.rules["@typescript-eslint/consistent-type-imports"] === "warn"
      );
      assert.ok(
        blockWithRule,
        "should have shared consistent-type-imports rule"
      );
    });

    it("should include test overrides", () => {
      const testBlock = config.find(
        (block) =>
          block.files &&
          block.files.some((f) => f.includes("test")) &&
          block.rules &&
          block.rules["no-console"] === "off"
      );
      assert.ok(testBlock, "should have test overrides disabling no-console");
    });
  });

  describe("ui", () => {
    let config;

    it("should load without errors", async () => {
      config = await loadAppConfig("apps/ui/eslint.config.js");
      assert.ok(Array.isArray(config), "config should be an array");
    });

    it("should include the shared ignores block", () => {
      const ignoresBlock = config.find(
        (block) => block.ignores && block.ignores.includes("dist")
      );
      assert.ok(ignoresBlock, "should have a block ignoring dist/");
    });

    it("should override globals to browser", async () => {
      const { globals } = await import("./index.mjs");
      const browserBlock = config.find(
        (block) =>
          block.languageOptions &&
          block.languageOptions.globals === globals.browser
      );
      assert.ok(browserBlock, "should have a block with browser globals");
    });

    it("should include react-hooks plugin", () => {
      const reactBlock = config.find(
        (block) => block.plugins && block.plugins["react-hooks"]
      );
      assert.ok(reactBlock, "should have react-hooks plugin");
    });

    it("should include react-refresh plugin", () => {
      const reactBlock = config.find(
        (block) => block.plugins && block.plugins["react-refresh"]
      );
      assert.ok(reactBlock, "should have react-refresh plugin");
    });

    it("should include react-refresh/only-export-components rule", () => {
      const blockWithRule = config.find(
        (block) =>
          block.rules &&
          block.rules["react-refresh/only-export-components"] !== undefined
      );
      assert.ok(
        blockWithRule,
        "should have react-refresh/only-export-components rule"
      );
    });

    it("should include test overrides", () => {
      const testBlock = config.find(
        (block) =>
          block.files &&
          block.files.some((f) => f.includes("test")) &&
          block.rules &&
          block.rules["@typescript-eslint/no-explicit-any"] === "off"
      );
      assert.ok(testBlock, "should have test overrides");
    });
  });
});
