# Database migrations

No migration is applied by this scaffold. Add migrations only with:
1. schema review,
2. apply/idempotence/concurrency tests in an isolated PostgreSQL instance,
3. RLS and effective-privilege tests,
4. rollback or forward-recovery procedure,
5. evidence attached to the current PR SHA.

Use a non-owner runtime role. Do not grant `BYPASSRLS`, superuser, `CREATEDB`, or `CREATEROLE` to the application runtime identity.
