# Migration runner transacional — fixture exclusiva PG18

Este incremento testa o mecanismo de execução, **não** autoriza migrations canônicas.
O único executável é `database/tests/migration-runner-fixture/runner.py`, sem opção para Neon, SQL arbitrário, configuração de URL, DDL de Production ou backfill de `iam.schema_migrations`. A política real continua BLOCKED/REVIEW_ONLY.

- Ambiente obrigatório: GitHub Actions, serviço PostgreSQL 18 local, URL literal do login de migração para iam_schema_test, marcador criado pelo administrador descartável, identidade SQL e ausência de neon.branch_id.
- Plano sintético fixo, três arquivos SQL SHA-256 dos bytes; a dependência 1002→1001 prova que nomes não definem a ordem. O terceiro é teste de rollback.
- Uma conexão autenticada iam_migrator_login, SET LOCAL ROLE iam_migrator→iam_owner, lock transacional, validação de ledger, DDL, validação de ACL/owner/RLS e escrita do ledger dentro de BEGIN/COMMIT. Sem CREATE IF NOT EXISTS para migrations, replay exige checksum igual.
- Em caso de erro, ON_ERROR_STOP fecha a conexão; a transação inteira volta. A prova verifica schema ausente após rollback inicial e ausência de novo objeto/linha após rollback sobre fixture existente.
- Suite integra database/tests/run.sh: mudança dos bytes, DAG inválido, URL externa, replay, lock ocupado em segunda sessão, checksum divergente no banco, drift FORCE RLS e ACL, default deny com linha sintética. Limpeza apenas dos schemas de teste criados na fixture.
- O ledger de teste em iam_runner_fixture é propositalmente separado do ledger histórico de IAM; não se destina a definir a baseline nem reproduz as migrations 0001–0004.

Próximo gate: reconciliar e aprovar baseline autenticada, adaptar o runner real a uma DAG aprovada, prever recuperação/custódia e testar em clone Neon recém autorizado. Nenhum segredo privilegiado, promoção, mudança de roles ou DDL em Production é autorizado por este incremento.
