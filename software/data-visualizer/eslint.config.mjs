import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  // Custom overrides
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  globalIgnores([
    // Default ignores of eslint-config-next
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);
