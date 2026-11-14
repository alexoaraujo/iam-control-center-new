# IAM canonical export and isolated restore — runbook vigente

> **Escopo operacional verificado: 13/11/2026, a partir da main `ef539ef78a7b3e2ac2b95ce39b3a21992dc3af0c`.** Esta é a fonte operacional vigente para o workflow `.github/workflows/iam-canonical-isolated-restore.yml`. Procedimentos que utilizem projetos, hosts, branches ou databases diferentes dos identificados abaixo são **não autorizados**. Esta documentação não concede permissão para executar DDL, GRANT, ALTER ROLE, backup, exportação, restore ou cutover.

## Identidade autorizada — Neon (control plane)

| Posição | Identificadores permitidos |
| --- | --- |
| Projeto único | `tiny-rice-70320263` (Neon `iam-database-delivery`) |
| SOURCE | `development` / `br-ancient-term-b6mmx5ol`, DB `iam_database` |
| SOURCE direct host | `ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech` |
| SOURCE principal | `iam_schema_export_reader`, LOGIN e NOBYPASSRLS, acesso insuficiente para exportação |
| TARGET | `validation/iam-canonical-restore-20261113` / `br-sweet-union-b6j80a7j`, DB **somente** `iam_canonical_validation` |
| TARGET direct host | `ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech` |
| TARGET principal | `neondb_owner` para conexão ao database descartável |
| TARGET expira | **2026-11-20T09:12:00Z**; verificar estado imediatamente antes de qualquer operação |

O database herdado `iam_database` na branch de validação não é destino aprovado. Neon roles são **branch-wide**, embora tabelas e privilégios sobre objetos sejam específicos do database. O placeholder `iam_schema_export_reader` no TARGET é NOLOGIN e não serve para autenticar na origem. Identidades de projeto/branch/endpoint exigem verificação pelo Neon control plane; catálogo SQL sozinho não comprova o branch ID.

**TLS e cliente:** conexão **direct**, não pooler; PostgreSQL 18/libpq; `PGSSLMODE=verify-full` e `PGSSLROOTCERT=system` (CA instalada na imagem Debian). A conexão cliente → proxy Neon é verificada pelo certificado/hostname na libpq; `pg_stat_ssl` da sessão proxy → PostgreSQL não prova o TLS externo e não deve ser usado como atestado.

## Gates atuais (evidência real versus testes sintéticos)

| Gate | Estado verificado | Evidência |
| --- | --- | --- |
| PR #60: diagnóstico TLS/identidade | **MERGED**, CI PASS | [PR #60](https://github.com/alexoaraujo/iam-control-center-new/pull/60) |
| PR #61: readiness integral antes de pg_dump | **MERGED**, revisão independente e CI na main PASS | [PR #61](https://github.com/alexoaraujo/iam-control-center-new/pull/61); [CI 43484910165](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43484910165); [PG18 43484910151](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43484910151) |
| `auth_only` externo | **PASS** no SHA anterior `0c257a7c4f422d35ccc7b5f5256c3ddb6fa273da`, `NO_DDL` | [run 43481191111](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43481191111), `PASS_AUTHENTICATED_IDENTITY_ONLY` |
| `readiness_only` | **BLOCKED** no SHA anterior | [run #28 / 43482719449](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43482719449): atributos de roles, membership do migrator e lock da origem |
| `export_only` | **BLOCKED** | [run #27 / 43482471663](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43482471663): insuficiência de privilégios para lock |
| `restore_isolated`, ledger, backup/PITR, cutover | **BLOCKED**, sem prova de operação canônica real | [Issue #15](https://github.com/alexoaraujo/iam-control-center-new/issues/15) |

Os textos `PASS_AUTHENTICATED_SCHEMA_EXPORT` e `PASS_ISOLATED_SCHEMA_RESTORE` nos **testes offline** são fixtures; **não** significam exportação ou restore real. A PR #61 tornou o contrato `check_authenticated_readiness` obrigatório em `readiness_only`, `export_only` e `restore_isolated` **antes de qualquer pg_dump**, mantendo a checagem de pré-DDL no restore.

### Bloqueios observados diretamente no Neon

- **`BLOCKED_SOURCE_SCHEMA_LOCK_PRIVILEGES`**: `iam_schema_export_reader` pode conectar, mas não tem `USAGE` nos schemas `iam`, `audit`, `app_private` e tem **0/23** tabelas elegíveis ao `ACCESS SHARE` para `pg_dump` (IAM 0/20, audit 0/2, app_private 0/1). Não conceder `SELECT ALL TABLES`, `BYPASSRLS` ou superuser para forçar PASS.
- **`BLOCKED_ROLE_ATTRIBUTES`**: SOURCE tem `iam_app_runtime_login.rolinherit=true` e somente esta login role das três esperadas; TARGET tem as três login roles e `iam_app_runtime_login.rolinherit=false`. Não copiar roles automaticamente: diferenças podem refletir contratos diferentes.
- **`BLOCKED_ROLE_MEMBERSHIPS`** (detectável após resolução do bloqueio anterior): SOURCE `iam_app_runtime_login → iam_app_runtime`: ADMIN=false, INHERIT=true, SET=false; TARGET: ADMIN=false, INHERIT=true, SET=true.
- **`BLOCKED_MIGRATOR_OWNER_MEMBERSHIP`**: SOURCE não possui `iam_migrator → iam_owner`; TARGET possui com ADMIN=false, INHERIT=false, SET=true.
- Metadados positivos: ACL principals `iam_owner`, `iam_app_runtime`, `iam_worker`, `iam_migrator` presentes no TARGET; `pgcrypto` instalado na SOURCE e disponível no TARGET. Esses resultados **não** liberam o resto dos gates.

### Export reader privilege contract — experimental / not grant approval

The runner now requires `MAINTAIN` on **23/23 tables** and `USAGE` on **3/3 schemas**, rejecting effective table `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` and schema `CREATE`. A lock obtained by broad table access must **not** satisfy readiness. The [PR #63](https://github.com/alexoaraujo/iam-control-center-new/pull/63) tests `pg_dump --schema-only` with `MAINTAIN` in *synthetic PostgreSQL 18 only*.

**`MAINTAIN` remains a broad maintenance capability, not an ACCESS SHARE-only permission.** Requiring it in a policy is not authority to grant it. Human review, risk analysis, strict timeboxing, clone rehearsal, explicit approval and rollback are mandatory before any real Neon action.

## Run workflow

Workflow: [IAM canonical export and isolated restore (manual)](https://github.com/alexoaraujo/iam-control-center-new/actions/workflows/iam-canonical-isolated-restore.yml). Selecionar branch `main` e validar SHA, revisão e environment **antes** de cada execução.

| Operação | Confirmação | Efeito permitido |
| --- | --- | --- |
| `preflight_only` | `NO_DDL` | Contratos offline, sem conexão/segredos |
| `tls_probe_only` | `NO_DDL` | Teste público sem credenciais; valida TLS/hostname |
| `auth_only` | `NO_DDL` | Autenticação e identidades de SOURCE/TARGET; sem DDL |
| `readiness_only` | `NO_DDL` | Consultas de catálogo, roles, ACLs, grants, pgcrypto e elegibilidade de lock; falha fechada |
| `export_only` | `NO_DDL` | **BLOQUEADO** até `readiness_only` PASS, aprovação específica e privilégio mínimo; quando aprovado, dump somente schema em runner efêmero |
| `restore_isolated` | `RESTORE_BR_SWEET_UNION_ONLY` | **BLOQUEADO** até gates independentes de exportação, ledger, rollback e DDL isolado; pode criar extensão antes de restore transacional |

A execução é manual (`workflow_dispatch`) e requer environment `IAM-Canonical-Isolated-Restore` no job autenticado. **Não repetir workflow em SHA antigo para validar código novo**. Logs e job status devem ser verificados em cada execução; job skipped nunca significa PASS. O conector GitHub usado em auditoria não disponibiliza `workflow_dispatch`: não alegar execução se não houver run ID real.

## Configure e valide ambiente protegido e segredos — sem divulgar valores

Environment: [GitHub Settings → Environments](https://github.com/alexoaraujo/iam-control-center-new/settings/environments) → `IAM-Canonical-Isolated-Restore`. Exigir revisor independente, impedir autoaprovação/bypass quando suportado no plano/visibilidade do repositório, limitar deployment branch à `main` e não confiar na simples existência do environment.

Segredos do **environment**, não do repositório: `IAM_CANONICAL_SOURCE_URL`, `IAM_CANONICAL_TARGET_URL`, `IAM_CANONICAL_OPERATOR_APPROVAL`. Os dois URLs devem ser diretos, fixados aos hosts/roles/databases da tabela acima e a `sslmode=verify-full&sslrootcert=system`; não devem ser copiados em comentários, commits, logs, shell history ou chat. Confirmação operacional/secret não substitui aprovação de mudança. O conector GitHub não confirma metadados/valores de segredos; o sucesso de `auth_only` prova a conexão da execução específica, não todas as proteções do environment.

Nenhuma correção de role deve ocorrer por este workflow. Para privilégios de exportação, exigir identidade temporária segregada, menor privilégio praticável, plano para `ACCESS SHARE` sem leitura indevida de dados, teste em clone isolado, inspeção de RLS/RBAC/ownership e rollback aprovado. Não utilizar `--no-acl`, grants em massa, superuser ou `BYPASSRLS` como atalhos. Toda alteração de role/membership é branch-wide e requer autorização separada.

## Neon control-plane permit list

O único projeto de referência é `tiny-rice-70320263`, com SOURCE `br-ancient-term-b6mmx5ol` e TARGET `br-sweet-union-b6j80a7j`. Verificar ID da branch, database e host em cada operação, não apenas nomes iguais de projeto. O TARGET está descartável, sem schemas IAM em `iam_canonical_validation` na inspeção de 13/11/2026, mas sua expiração e estado devem ser reconfirmados antes de qualquer tentativa de DDL.

O procedimento de seis `ALTER DEFAULT PRIVILEGES` em `public` das PRs [#45](https://github.com/alexoaraujo/iam-control-center-new/pull/45) e [#47](https://github.com/alexoaraujo/iam-control-center-new/pull/47) trata permissões de **objetos futuros**; não corrige os locks das 23 tabelas existentes nem autoriza migração. A PR [#44](https://github.com/alexoaraujo/iam-control-center-new/pull/44) contém comparadores offline, não prova paridade operacional real.

## Remaining required acceptance after running

1. Obter revisão independente da proposta de identidade temporária exportadora, grafo de roles, privilégios mínimos e efeito sobre runtime. Não presumir que SOURCE e TARGET devam ter as mesmas roles sem uma decisão arquitetural.
2. Simular a mudança e rollback em branch descartável separada antes de qualquer aplicação; validar ausência de BYPASSRLS, RLS A/B, negação cross-tenant e grant HTTP 200/revoke HTTP 403 no SHA aplicável.
3. Revalidar `readiness_only / NO_DDL` no SHA integrado e guardar o run ID; somente **PASS real** permite considerar `export_only`.
4. Antes de `restore_isolated`, reconciliar ledger, hashes, owners, ACLs e SECURITY DEFINER, além de backup e restauração ensaiados, incluindo limpeza/rollback e aprovação formal do escopo DDL no banco descartável.
5. Não inferir PITR, recuperação dos dados nem autorização de cutover a partir de um dump `--schema-only`; Production, Auth0 e Vercel permanecem preservados até gates próprios.

**Critérios de parada:** ambiente ou connection string divergente, reviewer ausente, branch expirada, role inesperada, divergência de privilégio/ACL/ledger, tentativa de export/restore sem readiness PASS ou mudança não autorizada no Neon. **Política:** usar ferramentas open-source e free-tier; não adicionar dependências pagas obrigatórias.
