# PEOS Environment governance — staged candidate

Status: HOLD. This candidate adds a local administrator metadata inventory and offline tests only. It does not modify any Environment, secret, Vercel/Auth0/Neon/B2 resource, existing gate, or reviewer policy.

## Local read-only inventory
From an audited checkout, use GitHub CLI with an existing authorized administrator connection that has access to environment and repository secret *metadata* and variables. Use least privileges, no token in arguments or shell history, and never paste the report publicly. Variable API payloads can include values; only names are emitted. Secret values are not retrievable. The script uses GET only and fails closed on incomplete data; exit 2 is deliberate HOLD, even for a complete report. No credentials are mounted in the offline workflow.

```sh
umask 077
python3 .github/scripts/peos-environments-inventory.py --live > /tmp/peos-environments-inventory.json
```

Treat the manifest as an inventory candidate, not a declaration of actual environments or authorization. Unknown names and missing candidates require reconciliation, never auto-creation/deletion. The live snapshot is observational and not atomic. Reviewer metadata alone does not prove independent approval.

## Migration sequence
1. Read effective policies, repository and environment secret names; validate Vercel/Auth0 applications and Neon lease custody separately.
2. Move the Vercel API token, Auth0 test credentials and database owner credentials away from PR-controlled code to a trusted main-only executor, validate exact SHA and independent approval as required, and verify OIDC trust and external credential scope. Do not execute PR code in a privileged job.
3. Reconcile existing single-maintainer, G1 and G3 validators, preserve all required reviews and no admin bypass. The current legacy auditor rejects the wildcard; it remains unchanged by design.
4. Only after segregation is proven, propose accepting exactly refs/pull/*/merge in the unprivileged Preview, retain main only if required, remove individual PR rules after positive/negative validation. No other wildcard or tag permitted.
5. Validate new PR, exact-SHA Preview and Auth0 E2E, security gate and negative cases. Keep Production HOLD.

No merge or privileged execution is authorized by the inventory, and no operation may treat single-maintainer approval as independent review.

## Phase 1 review extension
The inventory also reads repository variable names, configured reviewer identity (not proof of independence), wait timers and custom deployment protection IDs. All results remain observational. The initial PR had 10/10 offline tests passing; its general security gate blocked on AUTH0_E2E_NOT_SUCCESS. A dedicated verified Preview callback and safe credential segregation are still prerequisites; do not bypass the gate or grant privileges to PR code.

## PR workflow exposure diagnostics
Run `ruby .github/scripts/peos-pr-workflow-exposure.rb --report-only` on a reviewed checkout. It inventories PR-related events, secret references, reusable calls, dynamic secret access, Environment binding, OIDC/write permissions and checkout credential persistence. `--enforce` returns 2 on any finding; report-only is diagnostic while legacy jobs are migrated. It does not prove reachability, provider permissions, safety of scripts or effective secret values. Checkout-only findings are review candidates, not confirmed leaks. The 15 inventory tests passed at 90cde77a9039a4d9f7d61de65582154f5ebe7c4b; overall gate remains blocked by BRANCH_NOT_BOUND_TO_CALLBACK / AUTH0_E2E_NOT_SUCCESS.

## Phase 2 candidate: main-only Vercel metadata executor
The prior exact SHA 377bdc4f18135770d47f989be01eb4d3eefb9b81 passed Auth0 E2E and security-gate. The new manual-only candidate runs trusted main source, verifies current main and PR identity, reads effective main-only reviewer/no-bypass policy before binding the Environment, rechecks it before provider reads, and performs GET-only domain/alias/deployment metadata validation. It never executes PR source, requests OIDC, reads Auth0 passwords, connects to Neon, or changes Production. It does not satisfy Auth0 E2E or authorize wildcard activation. Configure Preview-Vercel-Metadata manually only after integration and review; independent reviewer with self-review prevention, no bypass, main-only, dedicated read-only token (no fallback to broad token), explicit exact SHA/PR/callback variables and token scope attestation. If the provider cannot offer an appropriately scoped read token on the free plan or GitHub metadata is unreadable, HOLD. Metadata is not independent approval or a proof of token scopes. The existing PR CI/gates remain unchanged until the trusted migration is validated. Never delete the Environment during a pending dispatch; GitHub auto-creation is possible if a named Environment is deleted between preflight and job binding, so deny by default and keep secrets exclusive to the protected Environment.

## Phase 2 review hardening
At 7b733606b1f2eb0d2d457b7c0c45c8fa2aa17401 all 37 offline checks and existing CI gates passed. The executor now requires a fresh dispatch (attempt 1), an unchanged Environment ID, at least one explicit eligible user other than the initiating maintainer, and a matching actual approval in the GitHub run review history before the provider secret step; it repeats this verification in the provider step. Team membership is not inferred and ambiguous history is blocked. No separate account is required or provisioned: if the single maintainer has no eligible independent reviewer, leave HOLD. No approval is manufactured by this code. Vercel GET-only behavior does not establish token permissions; provider scope remains an external prerequisite.

## Phase 2 Preview configuration parity
The trusted metadata candidate now also checks the effective Preview non-secret settings and presence (not values) of the three Auth0 application credentials, using the existing preflight contract. Vercel environment metadata is requested with decrypt=false; only Preview entries are evaluated. Domain and alias are read again after this check to reject drift. No environment inventory is emitted. The token must be independently attested as appropriately scoped; if the plan cannot provide suitable scope, HOLD rather than use a broader token. This is not a direct Auth0 Management API readback, a login test, or a migration of the legacy gate. The legacy workflow, Vercel trusted sources and all privileged Environment policies remain unchanged.
