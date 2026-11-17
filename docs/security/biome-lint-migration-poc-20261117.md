# PEOS — ESLint → Biome replacement: controlled PoC (2026-11-17 UTC)

**Repository:** `alexoaraujo/iam-control-center-new`  
**PR:** [#119](https://github.com/alexoaraujo/iam-control-center-new/pull/119)  
**Baseline main:** `17a4e86fddecc02c4326049fdf3d95fea6f4e522`  
**Scope:** developer lint/test dependencies only; no runtime Auth0/Vercel/Neon/Production changes.

## Goal and original failure

[Issue #116](https://github.com/alexoaraujo/iam-control-center-new/issues/116) tracks `GHSA-fc5q-39xc-vjpf` on `picomatch <=4.0.7`, without a patched version. The baseline [CI #44152897995](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44152897995) had `pnpm audit` FAIL, **two** HIGH audit paths through `eslint-config-next`. Audit waiver and lowering severity are prohibited.

## Changes and proof

1. Removed `eslint-config-next@16.4.5` and `eslint@10.14.0` from `apps/web/package.json`; replaced `lint` with `biome lint .`, using `@biomejs/biome@2.6.8` pinned.
2. Added `apps/web/biome.json` using Biome recommended rule preset, `next` and `react` recommended domains and generated file exclusions. Explicitly preserved `tsc --noEmit` and `vitest run`.
3. Replaced obsolete ESLint config and its compatibility test with `apps/web/biome.config.test.mjs`, with checks for Next, React, generated exclusions, dependency removals and the unchanged typecheck/test commands.
4. Generated `pnpm-lock.yaml` **on authenticated GitHub Actions runner** using pnpm 10.34.9 `pnpm install --lockfile-only --ignore-scripts`. GitHub [run #44156526386](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44156526386), job `regenerate-biome-lockfile` SUCCESS. Transferred the generated public lockfile unchanged to this branch (no fabricated integrity hashes).
5. Tested against the resulting frozen lockfile in [run #44157006241](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44157006241), job `biome-lint-proof` (#134300315395), around **2026-11-17T19:18Z**:
   - `pnpm install --frozen-lockfile` **PASS**.
   - `pnpm lint` (Biome) **PASS, with 25 non-blocking warnings** over 48 files (primarily CSS selector specificity and TypeScript assertions). Existing warnings must be reviewed; this is not parity evidence.
   - `pnpm typecheck` **PASS**.
   - `pnpm test` (Vitest, **19 test files**) **PASS**.
   - `node --test scripts/*.test.mjs`: **122 PASS**, 0 FAIL.
   - `pnpm build` (Next.js, inert CI-only values) **PASS**.
   - `pnpm audit` **FAIL: one HIGH advisory**. Remaining exact path: `apps__web > vitest > picomatch`.

**Interpretation:** the first vulnerable lint chain has been removed, but the project **still contains picomatch@4.0.7** because `vitest@5.0.5` and Vite use it. This PR neither fixes the CVE nor meets the SCA gate. The test runner cannot be removed casually: existing tests use `vi.hoisted`, `vi.mock`, `vi.stubEnv`, `it.each`, and `.tsx` React rendering. Native Node `node:test` lacks drop-in equivalence for those hooks and TSX without extra transforms.

## Lint rule coverage risks

The old ESLint config enabled Next Core Web Vitals and Next TypeScript presets. Biome v2 has `next` and `react` recommended domains covering important rules (including React hooks), but **functional test PASS does not prove an identical rule set**. Missing or differently scoped ESLint rules (including `jsx-a11y` and other Next core-web-vitals rules) need an explicit equivalence/negative-fixture review. Do not disable recommended Biome rules merely to obtain green checks.

## PEOS extension — effective rule inventory and negative regression, 2026-11-17 UTC

- Actual baseline `eslint --print-config src/app/page.tsx` on `main=17a4e86fddecc02c4326049fdf3d95fea6f4e522` confirmed **86 enabled ESLint rules**: Next.js 22, React Hooks 16, TypeScript lint 20, React 17, JSX accessibility 6, imports 1, core ESLint 4. Full named list and severities: [biome-eslint-effective-rules-inventory-20261117.md](./biome-eslint-effective-rules-inventory-20261117.md), source GitHub Actions [#44159264355](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44159264355).
- The Biome config was hardened to `error` for `useHookAtTopLevel`, `useExhaustiveDependencies`, `noImgElement` and `noStaticElementInteractions`. Synthetic invalid TSX fixtures are created only in temporary directories and deleted after each test.
- On [GitHub Actions #44159880087](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44159880087) (SHA `42889118456414fe5d1730e400f4a654cebde55f`), all four negative lint fixtures were rejected (4/4 PASS); Biome lint PASS with 25 existing warnings; TypeScript PASS; Vitest 96/96 PASS in 19 files; Node/PEOS contracts 126/126 PASS; Next.js build PASS.
- Exact-SHA [CI quality #44159879981](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44159879981) **FAIL** at mandatory `pnpm audit` with one HIGH: `apps__web > vitest > picomatch@4.0.7`. Separate local PG18 `security-gate` PASS does not override CI failure.
- **Full one-to-one parity is NOT PROVEN**. In particular, the baseline includes 16 React Hooks rules (many React Compiler-specific), 22 Next rules, 20 TypeScript lint rules and 6 accessibility rules. Four negative fixtures cover important subsets but cannot guarantee equivalence for all rules. Never convert `RULE_PARITY` to PASS solely based on successful app tests.

## Next safe gate

- [ ] Evaluate and remediate the 25 Biome warnings without suppressing security-critical rules. Independently inventory which ESLint rules were enforced and compare with Biome equivalents, including negative fixtures for React hooks, Next-specific elements and accessibility.
- [ ] Create a separate controlled proposal to replace the Vitest/Vite test runner with equal mock, TypeScript/TSX and database authorization regression coverage; verify alternative dependency tree before adopting it.
- [ ] Generate lockfile with pnpm and run clean `pnpm audit` **without waivers**.
- [ ] Rerun all required CI workflows, PG18/RLS, and branch-specific Preview/Auth0 as necessary on the integrated SHA.
- [ ] Obtain independent review; no release or merge until gates pass.

**PEOS verdict:** `BIOME_LINT_PASS=true`, `LOCKFILE_FROZEN_PASS=true`, `TYPECHECK_PASS=true`, `UNIT_TESTS_PASS=true`, `BUILD_PASS=true`, `PICOMATCH_DEPENDENCY_REMAINS=true`, `AUDIT=FAIL_HIGH_1`, `MERGE_MAIN=BLOCKED`, `PRODUCTION=UNCHANGED`.

Historical evidence and scaffold manifests from earlier dates must not be retroactively edited to claim full coverage of this PoC.
