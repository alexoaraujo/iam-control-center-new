# PEOS G1 — executor real de recuperação B2 para Neon descartável

Data UTC: 22/11/2026. Estado inicial: PR em revisão; nenhuma descriptografia ou DDL autorizado antes de aprovação.

## Origem e proveniência imutáveis

O arquivo aprovado corresponde à Development do projeto Neon tiny-rice-70320263, branch br-ancient-term-b6mmx5ol, database iam_database (NÃO Production).

- GitHub writer SHA: 0ee3e512bb761ce4d81202eb77a48a1ef9c77109; run: 44655204795.
- B2 bucket: iam-control-center-g1-backups.
- Objeto: iam-g1/full-backups/0ee3e512bb761ce4d81202eb77a48a1ef9c77109/20261120T014019Z-44655204795.pgdump.aesgcm
- SHA256 ciphertext: 610d5f0ef74ec77ebe35912207856d2a4638cab462a6f9e39d9c472382083aa9.
- Ciphertext: 110953 bytes; magic IAMG1A1!, AES-256-GCM, nonce 12 bytes, tag 16 bytes, AAD magic + SHA ASCII.
- B2 readback independente real com chave estritamente read-only: GitHub Actions run 44964345287, SUCCESS.
- Chave de decriptação: somente a MESMA AES-256-GCM 32 bytes do escrow original, nunca uma nova chave.

## Novo destino validado no Neon Free

- Projeto: tiny-rice-70320263, PostgreSQL 18.
- Branch: validation/iam-g1-full-restore-20261122, ID br-floral-glitter-b6zvytjp.
- Parent: development / br-ancient-term-b6mmx5ol.
- Host direto: ep-young-wind-b66dzic2.c-2.sa-east-1.aws.neon.tech.
- Database exclusiva reservada: `iam_g1_restore_validation` (owner `neondb_owner`); **não existe após a limpeza de teste anterior**. Antes de restaurar, recriá-la somente na branch descartável exata, confirmando 0 tabelas/0 policies/0 schemas IAM.
- Lease Neon revalidado em 22/11: expiração **2026-11-27T12:00:00Z**. Conferir novamente a cada execução e exigir margem residual mínima de 24 horas.
- Database herdada iam_database NUNCA é destino de restauração. Somente SELECTs de catálogo/contagens podem usá-la para a auditoria da cópia canônica.
- Neon Free: o projeto tinha 9 branches e agora tem 10. Nenhum 11º branch ou recurso pago deve ser criado.

## Execução segregada em GitHub Actions

Workflow em .github/workflows/iam-g1-b2-isolated-full-restore.yml, SOMENTE trusted main e workflow_dispatch.

1. preflight-no-secrets: verifica repo/ref, SHA atual de main via GitHub API, permissão explícita de operação e confirmação, janela de 24h, e SUCCESS dos checks main quality, pg18-security-contracts e g1-real-restore-offline-contract. Modo preflight_only opera sem segredos, B2 ou SQL.
2. stage-encrypted-ciphertext: Environment IAM-G1-B2-Full-Readback-Custody. A chave B2 não possui escrita ou administração. Native v4, bucket/prefixo, prova negativa, metadata, SHA256 e tamanho são revalidados. Transfere SOMENTE ciphertext para artifact de execução com retenção de 1 dia. Nenhuma chave AES ou conexão Neon está presente nesse job.
3. restore-and-audit-isolated-only: Environment separado IAM-G1-Full-Restore-Custody, somente main e sem bypass. Recebe apenas ciphertext do mesmo run. Verifica AES-GCM/tag e formato PGDMP em memória antes de qualquer DDL; valida URL de destino, host fixo, branch id, role, PostgreSQL18 e TLS verify-full. Rejeita database não vazia. Exige TOC com 23 tabelas, 41 policies, TABLE DATA e pgcrypto. Executa pg_restore --single-transaction --exit-on-error exclusivamente em iam_g1_restore_validation.
4. Auditoria e limpeza: compara as 23 tabelas, 41 políticas, 20 FORCE RLS, pgcrypto, ledger, hashes de owners/ACLs/schemas/funções e contagens de todas as tabelas com baseline herdado do mesmo clone (somente leitura). Rejeita IAM roles BYPASSRLS. Executa BEGIN + DDL/DML sintético + ROLLBACK e verifica ausência de resíduos. Finalmente elimina SOMENTE iam_g1_restore_validation, verifica sua ausência e preservação de iam_database. Fail-closed se qualquer etapa falhar.

O artifact é exclusivamente ciphertext já armazenado no B2, não plaintext, e expira em 1 dia. A chave AES não vai a artefatos, issues ou logs. Nenhum job com secrets executa código do HEAD de uma PR: o executor privilegiado só existe em main após merge validado. Todos os SHA-pins dos Actions devem permanecer.

## Custódia para liberar operação — pendências

O Environment `IAM-G1-Full-Restore-Custody` é distinto do Environment de Backup. O preflight do [run 45042697416](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/45042697416), em SHA `4e8add351a1e984f5db8bc14af882d556e846254`, comprovou `PASS_G1_RESTORE_PROTECTED_ENVIRONMENT_MAIN_ONLY`, **não** o conteúdo de vars/secrets. A auditoria read-only `.github/scripts/iam-g1-environment-readonly-attestation.py` deve consultar os **cinco** Environments G1 por nome, validar as identidades, IDs REST distintos e proteção, e registrar URLs administrativas resultantes. Nunca substituir o ID do Restore por um ID antigo de Backup.

Provisionar diretamente em GitHub Environments, a partir das respectivas fontes seguras:

- Secret IAM_G1_RESTORE_AES256_GCM_KEY_B64: exata chave original do AES-256-GCM do writer, Base64 de 32 bytes, sob escrow privado anterior.
- Secret IAM_G1_RESTORE_TARGET_DATABASE_URL: URI exclusiva do Neon para br-floral-glitter-b6zvytjp/iam_g1_restore_validation/neondb_owner, host direto, sslmode=verify-full e sslrootcert=system.
- Variable IAM_G1_RESTORE_APPROVED_SHA: SHA de main somente após merge e SUCCESS dos checks, sem confundir com SHA do writer.
- Variable IAM_G1_RESTORE_OPERATOR_APPROVAL: valor literal DISPOSABLE_ONLY_APPROVED, apenas após autorização do alvo.
- Variable IAM_G1_RESTORE_PRIVATE_ESCROW: valor literal PRIVATE_ESCROW_CONFIRMED apenas quando a chave original estiver de fato escrowed.

Nunca copiar esses secrets via conversa, Issues, browser remoto ou log. Nunca inserir secrets como inputs de workflow. O GitHub não permite ler o valor de um secret previamente cadastrado.

## Sequência dos gates

1. PR de código: quality, pg18-security-contracts, g1-real-restore-offline-contract, Auth0 E2E e security-gate SUCCESS no SHA exato; integrar por create merge commit e validar a árvore.
2. Main: revalidar quality, PG18 e offline contract no SHA final.
3. Revalidar Neon TTL, DB vazia, Environment main-only e secrets por NOME, nunca valores.
4. Modo preflight_only com NO_DDL; não chama secrets nem SQL.
5. Somente após custódia, dispatch restore_full com approved_main_sha exato e confirmação RESTORE_G1_FULL_B2_TO_EXACT_DISPOSABLE_ONLY.
6. Conferir markers PASS de autenticação AES real, TOC, restauracão, schema/ACL/RLS/ledger/rows, rollback e cleanup. Falha em qualquer etapa mantém HOLD.
7. Database de restauração é apagada depois do teste: não repetir sem recriação controlada de DB vazia no mesmo clone e nova revisão de lease.

## Production independente

A variável declarativa do Vercel Production `IAM_PRODUCTION_EXPECTED_NEON_BRANCH_ID` está configurada para **`br-muddy-snow-b63cepcv`** no projeto Neon `tiny-rice-70320263` (read-only, 22/11). Isso **não atesta a conexão efetiva do deployment**; confirmar fingerprint em runtime e alias ativa antes de qualquer promoção. O G1 deriva da Development, não é um backup Production. A Production requer backup próprio, readback, restore/rollback isolados, ledger, roles e chave exclusivos.

Estados (22/11/2026): `G1_FULL_CIPHERTEXT_READBACK=PASS`; `G1_PREFLIGHT_MAIN_SHA_4e8add351=PASS` (run 45042697416, sem DDL/secrets); `G1_REAL_RESTORE=NOT_ATTESTED` — [run 45025096069](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/45025096069) falhou durante SQL em SHA anterior e limpou o destino; `PRODUCTION_CUTOVER=HOLD`. Nenhum upgrade pago.
