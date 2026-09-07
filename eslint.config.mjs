import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated test output is removed/recreated by parallel verification.
    // Keep lint focused on source, not transient artifacts or local DB files.
    "test-results/",
    "playwright-report/",
    "artifacts/",
    "coverage/",
    ".tmp/",
    "supabase/.temp/",
  ]),
]);

export default eslintConfig;
