# PEOS — historical exact-SHA offline security gate proposal (#113)

Reconciled 2026-11-25 against main 19c265139404939814ffc59efb9c3f28016eab88. Status: HISTORICAL / NOT AUTHORIZED FOR EXECUTION.

The original [HEAD 8dd4b347](https://github.com/alexoaraujo/iam-control-center-new/tree/8dd4b347d5649204bd0055df4bd8d3d391233a16) proposed an offline-evidence exception to Auth0 E2E for three scopes. The proposal is not integrated as executable policy: it would accept an Auth0 E2E skipped result for non-documentary changes. Current PEOS requires the real E2E for sensitive changes and no transfer of authorization. Original verifier, workflow changes, and tests remain in Git ancestry, not in the current diff.

PRs #87 and #98 were genuinely reduced to historical documentation and passed their documentary gates at their respective exact SHAs; this does not waive E2E for code. Canonical manifest/ledger and B2 code continue to require the existing integrated security gate. If offline provenance is wanted later, implement it as additive evidence, never as a replacement for Auth0, in a separate reviewed PR with negative tests.

The earlier proposed #113 lease and evidence vehicles #114 and #115 reference historical SHAs and shared callback state. They are not authorization for a new HEAD or a new lease. No callback transfer, credential change, environment relaxation, production promotion or operational approval results from this archival change.
