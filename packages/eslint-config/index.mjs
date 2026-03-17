import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

/**
 * Shared base ESLint flat config for the Moveet monorepo.
 *
 * Usage in app eslint.config.mjs:
 *   import { base, testOverrides } from "@moveet/eslint-config";
 *   export default tseslint.config(...base, ...testOverrides, { ... });
 *
 * `base` provides:
 *   - dist/ ignored
 *   - @eslint/js recommended + typescript-eslint recommended + prettier
 *   - Common rules for no-console, no-explicit-any, consistent-type-imports, no-unused-vars
 *   - Targets **\/*.ts files with Node.js globals by default
 *
 * `testOverrides` relaxes rules for test files.
 *
 * Apps can override globals (e.g. globals.browser for the UI) and add
 * app-specific plugins/rules on top.
 */

/** Base config blocks shared by every app. */
export const base = [
  { ignores: ["dist"] },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      prettierConfig,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.node,
    },
    rules: {
      "no-console": ["warn", { allow: ["info", "log", "error", "warn"] }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];

/** Test file overrides — relaxes no-explicit-any and no-console for tests. */
export const testOverrides = [
  {
    files: ["**/__tests__/**/*.ts", "**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "no-console": "off",
    },
  },
];

// Re-export dependencies so apps don't need to import them separately.
export { globals, tseslint };
