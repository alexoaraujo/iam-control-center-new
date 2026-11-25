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
