# Minimatch override: security and compatibility boundary

## Current resolution

The workspace root pins `minimatch@11.0.3` through the pnpm override so the dependency audit does not retain the vulnerable `10.2.6` resolution reported for GHSA-g3hv-75wg-m249. The override is global in the current dependency graph; it therefore crosses the declared ranges of some transitive consumers.

The maintainer advisory identifies `10.2.6` as affected and `11.0.1` as fixed. The GitHub Advisory Database currently publishes the broader range `<11.0.1`. Do not interpret this discrepancy as proof that every older release is safe, and do not suppress `pnpm audit`.

## Known API boundary

The current lockfile includes `eslint-plugin-import@2.32.0`. Its `no-internal-modules` rule calls `minimatch.makeRe()`; minimatch 11 removed that API. The current Next.js ESLint configuration does not enable `import/no-internal-modules`.

**Restriction:** do not enable `import/no-internal-modules` while this override and plugin version remain in place. The regression test in `apps/web/eslint.config.test.mjs` enforces that restriction. Revisit it only after upgrading/replacing the consumer with a compatible release or applying and testing a maintained patch.

## Evidence and residual risk

- The current lockfile resolves the ESLint import plugin and TypeScript ESLint parser through the global override.
- The existing CI run on the prior HEAD `d964c8ba982365a66518e7ddae52dfb744fbecdf` completed successfully (run `41556689066`). That is historical evidence for that SHA only; it does not validate this follow-up commit or prove compatibility of every transitive API.
- The Preview deployment for that prior HEAD was skipped/canceled, so a new Preview READY deployment was not established by that run.
- The normal lint, typecheck, test, and build gates exercise the repository's current paths; they are not exhaustive tests of every optional rule or every downstream consumer of minimatch.

This document records a containment boundary, not a claim that the global override is universally compatible. Keep PR #48 Draft until the new commit has fresh CI, an actual Preview READY deployment on its exact SHA, and the remaining dependency-compatibility review is closed.
