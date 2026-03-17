import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { base, testOverrides, globals, tseslint } from "./index.mjs";

describe("@moveet/eslint-config", () => {
  describe("base export", () => {
    it("should export an array", () => {
      assert.ok(Array.isArray(base), "base should be an array");
    });

    it("should have exactly 2 config blocks", () => {
      assert.equal(base.length, 2, "base should have ignores + main config");
    });

    it("should have an ignores block for dist/", () => {
      const ignoresBlock = base[0];
      assert.ok(ignoresBlock.ignores, "first block should have ignores");
      assert.ok(
        ignoresBlock.ignores.includes("dist"),
        'ignores should include "dist"'
      );
    });

    it("should target ts and tsx files", () => {
      const mainBlock = base[1];
      assert.ok(mainBlock.files, "main block should have files pattern");
      assert.ok(
        mainBlock.files.some((f) => f.includes("ts")),
        "files should include ts"
      );
    });

    it("should use Node.js globals by default", () => {
      const mainBlock = base[1];
      assert.deepStrictEqual(
        mainBlock.languageOptions.globals,
        globals.node,
        "default globals should be Node.js"
      );
    });

    it("should set no-explicit-any to warn", () => {
      const mainBlock = base[1];
      assert.equal(
        mainBlock.rules["@typescript-eslint/no-explicit-any"],
        "warn",
        "no-explicit-any should be warn for consistency"
      );
    });

    it("should set consistent-type-imports to warn", () => {
      const mainBlock = base[1];
      assert.equal(
        mainBlock.rules["@typescript-eslint/consistent-type-imports"],
        "warn"
      );
    });

    it("should configure no-unused-vars with underscore ignore patterns", () => {
      const mainBlock = base[1];
      const rule = mainBlock.rules["@typescript-eslint/no-unused-vars"];
      assert.ok(Array.isArray(rule), "no-unused-vars should be an array");
      assert.equal(rule[0], "warn");
      assert.equal(rule[1].argsIgnorePattern, "^_");
      assert.equal(rule[1].varsIgnorePattern, "^_");
    });

    it("should configure no-console with allowed methods", () => {
      const mainBlock = base[1];
      const rule = mainBlock.rules["no-console"];
      assert.ok(Array.isArray(rule), "no-console should be an array");
      assert.equal(rule[0], "warn");
      assert.ok(rule[1].allow.includes("error"));
      assert.ok(rule[1].allow.includes("warn"));
    });

    it("should include extends with eslint recommended and typescript-eslint", () => {
      const mainBlock = base[1];
      assert.ok(
        mainBlock.extends,
        "main block should have extends"
      );
      assert.ok(
        mainBlock.extends.length >= 2,
        "extends should have at least eslint recommended + ts-eslint"
      );
    });
  });

  describe("testOverrides export", () => {
    it("should export an array", () => {
      assert.ok(
        Array.isArray(testOverrides),
        "testOverrides should be an array"
      );
    });

    it("should have exactly 1 config block", () => {
      assert.equal(testOverrides.length, 1);
    });

    it("should target test files", () => {
      const block = testOverrides[0];
      assert.ok(block.files, "testOverrides block should have files");
      const filesStr = block.files.join(" ");
      assert.ok(
        filesStr.includes("test"),
        "testOverrides should target test files"
      );
    });

    it("should disable no-explicit-any for tests", () => {
      const block = testOverrides[0];
      assert.equal(
        block.rules["@typescript-eslint/no-explicit-any"],
        "off",
        "no-explicit-any should be off in tests"
      );
    });

    it("should disable no-console for tests", () => {
      const block = testOverrides[0];
      assert.equal(
        block.rules["no-console"],
        "off",
        "no-console should be off in tests"
      );
    });
  });

  describe("re-exports", () => {
    it("should re-export globals", () => {
      assert.ok(globals, "globals should be exported");
      assert.ok(globals.node, "globals.node should exist");
      assert.ok(globals.browser, "globals.browser should exist");
    });

    it("should re-export tseslint", () => {
      assert.ok(tseslint, "tseslint should be exported");
      assert.ok(
        typeof tseslint.config === "function",
        "tseslint.config should be a function"
      );
    });
  });

  describe("composability", () => {
    it("should work with tseslint.config() without errors", () => {
      const result = tseslint.config(...base, ...testOverrides);
      assert.ok(Array.isArray(result), "composed config should be an array");
      assert.ok(result.length > 0, "composed config should not be empty");
    });

    it("should allow overriding globals for browser environments", () => {
      const result = tseslint.config(...base, ...testOverrides, {
        files: ["**/*.{ts,tsx}"],
        languageOptions: {
          globals: globals.browser,
        },
      });
      assert.ok(Array.isArray(result));
      // The last block should have browser globals
      const lastBlock = result[result.length - 1];
      assert.deepStrictEqual(
        lastBlock.languageOptions.globals,
        globals.browser
      );
    });

    it("should allow adding app-specific rules", () => {
      const result = tseslint.config(...base, {
        files: ["**/*.ts"],
        rules: {
          "@typescript-eslint/no-require-imports": "off",
        },
      });
      assert.ok(Array.isArray(result));
      const lastBlock = result[result.length - 1];
      assert.equal(
        lastBlock.rules["@typescript-eslint/no-require-imports"],
        "off"
      );
    });
  });
});
