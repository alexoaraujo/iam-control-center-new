# PEOS G2 — executor offline de reconciliação canônica (23/11/2026)

## Objetivo

Integrar os verificadores existentes para auditar, SEM EXECUTAR SQL, a divergência de schema, roles, RLS, ACLs e provenance de migrations entre as branches Neon Development e Production de tiny-rice-70320263. Este executor NÃO é um migration runner e nunca autoriza DDL, backfill de ledger, grants, G3 privilegiado ou deploy de Production.

Fonte do código: main previamente validada em SHA 97a8af863c25f0f4f8e945968e2340aacbbed247. O executor usa as bibliotecas existentes database/offline/compare-schema-manifests.mjs, database/offline/compare-migration-ledgers.mjs e scripts/check-migration-lineage.mjs.

## Aquisição de evidências autorizadas

1. Confirme projeto e branch IDs pelo control-plane Neon. Development: br-ancient-term-b6mmx5ol; Production: br-muddy-snow-b63cepcv. O database é iam_database, PostgreSQL 18, conexão com TLS. NÃO derive branch por hostname, nome de variável ou URL presumida.
2. Por conexão em leitura autorizada, execute o arquivo database/scripts/schema-manifest.sql SEPARADAMENTE em cada branch. Ele retorna um único JSON de catalogação (sem registros das tabelas de negócio). Guarde os arquivos do manifest fora do repositório, sob custódia controlada; NÃO publique o conteúdo completo no log.
3. Determine a existência de iam.schema_migrations exclusivamente via catálogo. Onde não existir, use ledger=null; NÃO crie a tabela nem invente linha ou checksum. Onde existir, obtenha por leitura aprovada apenas migration_id, checksum_sha256, source_sha, applied_at e execution_role. Preserve os identificadores da branch comprovados pelo control-plane e formate no contrato iam-ledger-provenance/v1. No Development observado em 23/11 o ledger existe, com ZERO linhas.
4. Monte um arquivo JSON local com o contrato iam-canonical-reconciliation-evidence/v1. A propriedade source inclui branch_id, database, schema_manifest e ledger; target inclui os mesmos campos, mas ledger é null quando inexistente. project_id deve ser tiny-rice-70320263. Apenas a reconciliação Development→Production atual é admitida: IDs distintos e exatos.
5. Execute localmente: node database/offline/reconcile-canonical-readonly.mjs /CAMINHO/observacao.json. Status 1 = BLOCKED (intencional, mesmo com metadata idêntica); status 2 = evidência inválida. NUNCA interprete status 0, testes verdes ou ausência de diferenças como autorização de Production.

## Controles de engenharia

- Comparator de schema: 14 seções de pg_catalog, incluindo funções com SHA-256 de definição, tipos/ordem de enums, owners, policies, ACLs e membership options. Diffs exibidos apenas como contagem; não imprime bodies de funções nem dados de tabelas.
- Comparator de ledger: identidades de versões, SHA-256, source commit, execution role e rejeição de entradas divergentes ou vazias. Não cria histórico sintético.
- Política de lineage: 0001 clean-install e 0002/0003/0004 de precondições distintas; todos REVIEW_ONLY e execution_authorized=false. O executor reconstrói checksums dos arquivos SQL reais e recusa política modificada.
- Fail closed: sem interface para DATABASE_URL, conexão Neon, acesso ao GitHub/Vercel, shell SQL, operação --execute, write-back, secret de Production ou bypass. Flags de execução e promoção sempre false; inputs são declaradamente não autenticados.
- Testes: scripts/canonical-reconciliation-readonly.test.mjs integra CI quality (node --test scripts/*.test.mjs) e a suite PG18 database/tests/run.sh; inclui drift Production-empty, ledger ausente/ambos vazios, SHA adulterado, role BYPASSRLS, parity sem autorização e ausência de leak no CLI.

## Resultado esperado na fotografia real

O schema manifest real foi executado por leitura em Neon Development e Production: Development 23 tabelas, 41 policies, 46 rotinas e ledger vazio; Production zero tabelas IAM, zero policies, zero rotinas e ledger inexistente. Logo, schema drift e migration lineage permanecem BLOQUEADOS. O próprio vínculo do deploy efetivo Vercel→Neon ainda depende de uma atestação separada pelo runtime (GET /api/ready autenticado e checagem de identidade).

## Próximo gate, separado da PR de desenvolvimento

Nova proposta aprovada com manifests autenticados e proveniência independente, reconciliar roles de Production e descrever um migration runner verdadeiro (advisory transaction lock, ledger atômico, checksum e rollforward/rollback). Ensaiar somente em clone Neon recém criado com TTL, custódia separada e testes PostgreSQL 18. Antes de qualquer autorização Production, exigir revisão independente, recuperação real, SHA exato e verificação do deployment/branch. Aprovações G1/G3 anteriores não se aplicam.
