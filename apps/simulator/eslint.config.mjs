import { base, testOverrides, tseslint } from "@moveet/eslint-config";

export default tseslint.config(
  ...base,
  ...testOverrides,
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  }
);
