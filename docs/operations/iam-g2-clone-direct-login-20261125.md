# G2 — clone direct-login baseline proof (staged)
Observed in br-solitary-sunset-b681d15f: candidate ACL changes passed catalog
checks and intentional subtransaction rollback. Before/after fingerprint
af4d49e3855fc20aac2e7cecbb599a82; zero ledger rows; 18 forced-RLS relations.
SET ROLE reader was denied (42501); do not add memberships to bypass.
The connector's server-side pg_stat_ssl was false; it cannot certify client TLS.

This PR adds a private local, read-only probe of the original clone ACL state.
Fixed project context tiny-rice-70320263, direct endpoint
ep-polished-sound-b6pydcfq, branch br-solitary-sunset-b681d15f, database
iam_database, reader role only, hard expiry 2026-11-26T03:00Z. No arbitrary
host, role, SQL, credentials from CI, or ACL changes. On reviewed exact clean
main, in a private Linux terminal with trusted PostgreSQL client and system CA,
run python3 -B database/scripts/g2-clone-direct-login.py APPROVED_MAIN_SHA.
Existing reader credential only; never send it in chat or fetch/reset it for
this test. No fallback to weaker TLS. No raw stdout/stderr from psql published.
CI runs synthetic unit tests only. Expired clone fails closed; new target
requires a separately reviewed change, no automatic expiry extension.
Before live use verify Neon endpoint ownership and TTL administratively.
Successful libpq verify-full and channel_binding=require plus fixed direct
host and SQL identity provide client-side proof, not server-side TLS telemetry.

Independent authenticated sessions cannot see uncommitted GRANT/REVOKE.
The authorized transaction-only rehearsal cannot establish functional tests
under separately logged-in remediated roles. A future separate approval
must explicitly cover a short committed ACL window in an isolated clone,
full before-image/rollback plan, independent login credentials, exact SHA,
reviewed callers, cleanup and postflight; no such change is implemented here.
No migration, no acquisition, no ledger backfill, no G3 or Production.

## Diagnóstico local sem segredos
Use Linux/WSL com Python 3, git, psql e ca-certificates. Python nativo Windows/Git Bash não é suportado. Não exporte PGPASSWORD nem altere as constantes de TLS, branch ou TTL. O executor verifica dependências antes do prompt privado e emite códigos fixos (LINUX_OR_WSL_REQUIRED, GIT_CLIENT_MISSING, PSQL_CLIENT_MISSING, SYSTEM_CA_MISSING, SYSTEM_CA_INVALID, GIT_CHECKOUT_QUERY_FAILED, MAIN_HTTP_*, MAIN_NETWORK_OR_TLS_FAILED, PRIVATE_PASSWORD_PROMPT_FAILED, PSQL_TIMEOUT, PSQL_CLIENT_EXECUTION_FAILED, PSQL_OUTPUT_INVALID). DIRECT_LOGIN_OR_TLS_FAILED permanece genérico para stderr do servidor. Nenhum erro imprime credenciais, URLs de conexão ou stderr bruto. O resultado ainda é apenas baseline read-only. Use SHA main exato após aprovação e merge; não executar versão de PR como prova operacional.
