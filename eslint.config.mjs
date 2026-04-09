import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "**/dist/**",
    "**/coverage/**",
    "**/tests/**",
    "**/*.test.ts",
    ".worktrees/**",
    ".forgeflow-dispatcher/**",
    ".orchestrator/**",
    "apps/console/**",
  ]),
  {
    files: [
      "apps/dispatcher/src/**/*.ts",
      "packages/*/src/**/*.ts",
      "scripts/**/*.ts",
      "services/*/src/**/*.ts",
    ],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
      "no-empty": "off",
    },
  },
]);
