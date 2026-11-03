import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Keep import/no-internal-modules disabled while the root pnpm override forces
// minimatch 11: eslint-plugin-import@2.32.0 calls the removed minimatch.makeRe()
// API when that rule is enabled. eslint.config.test.ts guards this constraint.
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "node_modules/**",
    "next-env.d.ts",
  ]),
]);
