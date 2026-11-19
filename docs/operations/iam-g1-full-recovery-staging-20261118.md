# PEOS IAM G1 — Preparação controlada do backup integral e restore isolado

**Estado:** PREPARAÇÃO / NÃO EXECUTADO. **Revisão:** 2026-11-19. **Projeto:** `tiny-rice-70320263` (Neon Free, PostgreSQL 18).
Este contrato não executa `pg_dump`, B2, DDL, migrações ou recuperação. Não declarar `G1_FULL_BACKUP_RESTORE=PASS`.

## Evidência e dependências já existentes

- [PR #132](https://github.com/alexoaraujo/iam-control-center-new/pull/132): CI [#44391401472, tentativa 4](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44391401472/attempts/4), SHA `3da16f0c18f3ab4067f47ee7e6ca666862c45778`: E2E Auth0 grant HTTP 200, negativas tenant B/identidade/permissão HTTP 403, revoke HTTP 403 mesma sessão, cleanup 0 — todos PASS. Não alterar SHA da #132 para implantar este G1.
- [B2 upload #43987013885](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/43987013885): objeto **sintético** cifrado enviado, SHA-256 registrado na [Issue #97](https://github.com/alexoaraujo/iam-control-center-new/issues/97). **Não** é backup real.
- [PR #101](https://github.com/alexoaraujo/iam-control-center-new/pull/101): integrada à `main`; readback real de objeto **sintético** aprovado em [run #44504075979, tentativa 2](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44504075979/attempts/2): `PASS_B2_INDEPENDENT_READBACK_CIPHERTEXT_SHA256`, 126 bytes. Não equivale a backup real nem decriptação/restore.
- [Issue #15](https://github.com/alexoaraujo/iam-control-center-new/issues/15): cadeia de migrations, ledger e recuperação real; permanece aberta.
- Neon `list_snapshots=[]` em 18/11/2026. Snapshots Neon, se houver futuramente, não substituem cópia independente com custódia.

## Allowlist imutável do estágio

| Campo | Origem | Destino |
| --- | --- | --- |
| Projeto | `tiny-rice-70320263` | `tiny-rice-70320263` |
| Branch | `development / br-ancient-term-b6mmx5ol` | `validation/iam-canonical-restore-20261113 / br-sweet-union-b6j80a7j` |
| Host direto | `ep-winter-leaf-b6cp8d2c.c-2.sa-east-1.aws.neon.tech` | `ep-crimson-smoke-b6jxg2v5.c-2.sa-east-1.aws.neon.tech` |
| Database | `iam_database` | SOMENTE `iam_canonical_validation` |
| Identidade prevista | `neondb_owner` (backup controlado) | `neondb_owner` (destino isolado) |

Nunca usar o database herdado `iam_database` do destino. A origem registra 23 tabelas, 41 RLS policies e `pgcrypto` instalada. O destino está vazio para schemas IAM, `pgcrypto` **não instalada**; implantação específica da extensão exige revisão e aprovação de DDL separada. O destino teve seu TTL estendido **somente no clone descartável** de `2026-11-20 09:12:00 UTC` para **`2026-11-22 09:12:00 UTC`** (Neon `br-sweet-union-b6j80a7j`, sem alterações em dados/DDL). Este PR sincroniza o limite local `TARGET_EXPIRY` e testes com a alteração efetiva do Neon. O preflight rejeita a execução a partir do novo limite; substituição posterior de clone/host/TTL exige novo commit revisado e validação do Neon.

**Barreira adicional (19/11/2026):** o preflight exige **pelo menos 24 horas completas de TTL restante** para reservar uma janela operacional de verificação independente, readback, restauração e rollback. Em menos de 24h, resulta em `BLOCKED_G1_TARGET_TTL_INSUFFICIENT_RECOVERY_WINDOW`; no vencimento exato ou após ele, `BLOCKED_G1_TARGET_TTL_EXPIRED`. Essa margem é uma política conservadora, não uma estimativa de tempo de execução nem permissão para operar. Além disso, a URL PostgreSQL com **porta explícita `:0` é rejeitada**, sem convertê-la silenciosamente para `5432`. Porta omitida continua resolvendo para o padrão PostgreSQL. Os testes continuam totalmente sintéticos. Esta extensão **não autoriza backup real, restauração, grant administrativo ou cutover**.

## Guardas do estágio sem acesso à rede

O script `database/scripts/iam-g1-full-recovery-preflight.py --check` recebe apenas variáveis de ambiente, nunca conexões como argumentos. Espera:
- `GITHUB_REPOSITORY=alexoaraujo/iam-control-center-new`, `GITHUB_REF=refs/heads/main` e `GITHUB_SHA` correspondente exatamente ao valor previamente registrado em `IAM_G1_RECOVERY_APPROVED_SHA` no Environment protegido.
- Segredos `IAM_G1_FULL_BACKUP_SOURCE_URL` e `IAM_G1_FULL_BACKUP_TARGET_URL`, **exclusivos** da recuperação, sem reuso do export reader nem da fixture PR132.
- Ambos URIs `postgresql://` sem `-pooler`, `sslmode=verify-full&sslrootcert=system`, role `neondb_owner`, database, endpoint e CA conferidos. Presença opcional de `channel_binding=require`.
- `IAM_G1_B2_BUCKET=iam-control-center-g1-backups`, `IAM_G1_B2_ENDPOINT=https://s3.us-east-005.backblazeb2.com`, `IAM_G1_B2_REGION=us-east-005`, `IAM_G1_B2_OBJECT_PREFIX=iam-g1/full-backups/`.

**Não crie novas credenciais por este documento.** No plano de mantenedor único, a autorização nominal pode ser feita pelo próprio mantenedor, mas não pode substituir o SHA, a custódia, as verificações técnicas ou o restore real.

## Execução de backup e restore: gate futuro, não implementado nesta PR

1. Obter a autorização operacional de exportação de dados reais, identidade de destino e compromisso de custódia; confirmar políticas GitHub Environment por leitura autenticada. A instância de teste com `neondb_owner` não autoriza automaticamente exportação de Development.
2. Validar PostgreSQL/libpq 18 com TLS `verify-full` para SOURCE/TARGET; executar `pg_dump -Fc` completo com dados, catálogo das 23 tabelas, extensão `pgcrypto`, ACLs, proprietários, policies e manifesto de `pg_dumpall --globals-only --no-role-passwords` sob segredo protegido. Não salvar dados em logs, PR, issues, artifacts públicos ou computador não custodiado.
3. Criptografar e selar o dump **antes** de envio ao B2 com chave separada e privada, geração de digest e manifesto de prova; retenção e readback **independentes** do writer, verificando hash/metadata e capacidade de decriptação. Nenhum segredo deve aparecer na CLI/argumentos/logs.
4. Validar `pg_restore --list` e entradas TABLE DATA. Avaliar criação `pgcrypto` exclusivamente no banco alvo descartável, **após** aprovação explícita de DDL. Restaurar apenas em `iam_canonical_validation`, nunca no `iam_database` herdado e jamais em Production.
5. Provar contagens e integridade dos 23 objetos/tabelas, 41 policies, RLS/ FORCE RLS, ACLs, owners, 0/ledger quando correspondente à origem, hashes e privilégio de runtime; registrar RPO/RTO e ensaiar rollback pós-commit, confirmando readback independente.
6. Registrar IDs de GitHub run, Neon project/branch, timestamps UTC, checksums e resultado; atualizar [Issue #15](https://github.com/alexoaraujo/iam-control-center-new/issues/15). Até esses passos, `G1_FULL_BACKUP_RESTORE=NOT_ATTESTED` e `MERGE_MAIN/PRODUCTION_CUTOVER=BLOCKED`.

## Verificação offline

```bash
python3 database/tests/test-iam-g1-full-recovery-preflight.py -v
```

São testes sintéticos, sem segredos, banco ou B2. Um teste verde **não** habilita backup ou restauração.
