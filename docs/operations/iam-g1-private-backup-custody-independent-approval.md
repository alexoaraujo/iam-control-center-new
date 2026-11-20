# IAM G1 — aprovação independente de custódia privada e backup integral

**Status inicial: `BLOCKED / NOT AUTHORIZED`.** Este documento é um contrato de revisão para uma PR. **Aprovar/mesclar a PR não autoriza** conexão administrativa, leitura/exportação de dados, alteração de roles, `pg_dump`, restore, rollback ou cutover. A aprovação operacional deve ser publicada separadamente pelo revisor independente na [Issue #94](https://github.com/alexoaraujo/iam-control-center-new/issues/94), após verificação das evidências.

## 1. Identidade e escopo imutáveis

| Parâmetro | Valor |
| --- | --- |
| Projeto Neon | `tiny-rice-70320263` |
| Branch descartável de origem | `br-spring-grass-b6gap6kp` |
| Database de origem | `iam_database` |
| Host Direct | `ep-sparkling-sea-b6iw0z9y.c-2.sa-east-1.aws.neon.tech` |
| Porta / TLS | `5432` / `sslmode=verify-full`, CA do sistema |
| Identidade proposta | `neondb_owner` já existente; **somente no clone** |
| Expiração absoluta do clone | `2026-11-16T12:00:00Z` (09:00 BRT) |
| SHA de referência PR #41 | `0a681b73f40cd1b28db54e57f3813eefcdf0e64c` |
| Destino de restauração **futura** | `br-sweet-union-b6j80a7j` / `iam_canonical_validation` |
| Issue de decisão operacional | [#94](https://github.com/alexoaraujo/iam-control-center-new/issues/94) |
| Issue de governança G1 | [#32](https://github.com/alexoaraujo/iam-control-center-new/issues/32) |

A verificação de catálogo observou `neondb_owner` com `SELECT/MAINTAIN` nas 24 relações, `SELECT/USAGE` nas três sequências, `USAGE` nos três schemas, `LOGIN` e `BYPASSRLS`. Isso **não** prova `pg_dump`, capacidade de `pg_dumpall` ou custódia do arquivo. Não alterar `iam_schema_export_reader` nem conceder novos privilégios para esse fluxo.

## 2. Checklist de custódia privada — completar antes de solicitar aprovação final

- [ ] Destino de armazenamento **privado e durável** definido, sob controle do proprietário; URI/identificador interno guardado em canal restrito, não em PR pública.
- [ ] Região, residência de dados, finalidade, LGPD, retenção e descarte aprovados. **Neon Object Storage não está disponível para este projeto em `aws-sa-east-1`**; não copiar dados para outra região sem aprovação explícita.
- [ ] Arquivo criptografado **antes** de sair do runner, com chave separada dos dados, política de rotação/recuperação, TLS e controle de acesso por menor privilégio.
- [ ] Credencial de escrita temporária/prefixada e segredo de conexão do clone exclusivamente em GitHub Environment protegido, com revisor diferente do executor, sem bypass, sem uso de `pull_request_target` ou código não confiável.
- [ ] Proibição de upload de dados IAM em logs, PRs, issues, artifacts de Actions, cache, pastas públicas ou armazenamento sem retenção contratada.
- [ ] Procedimento privado de verificação de download/decriptação, integridade SHA256 do **arquivo completo**, cadeia de custódia, destruição segura e evidência de auditoria sem conteúdo pessoal.
- [ ] Plano para indisponibilidade/falha: interromper exportação, invalidar credenciais temporárias, apagar arquivo parcial, registrar evidências sem dados sensíveis e manter `BLOCKED`.
- [ ] Revisor independente verificou a existência real dos controles, e não apenas este checklist marcado pelo executor.

## 3. Contrato de backup proposto (não executar por aprovação da PR)

1. Revalidar em tempo real o projeto, ID da branch, host, database, role, expiração, SHA e GitHub Environment. Se algum item divergir ou a branch expirar, **FAIL-CLOSED** e solicitar nova decisão.
2. Após a aprovação operacional **específica**, usar conexão Direct exclusiva ao clone e cliente PostgreSQL 18 compatível; `pg_dump --format=custom` deve incluir **schema + dados** das schemas `iam`, `audit`, `app_private`, sem `--schema-only` ou `--enable-row-security` que comprometa a cobertura. Verificar escopo de objetos externos e dependências.
3. Tentar exportar globals/roles **sem senhas** somente se a política e o Neon gerenciado permitirem. Se não permitir, registrar inventário autorizado e lacuna como bloqueio de paridade, não simular globals completos.
4. Produzir em ambiente privado manifesto de SHA256 do arquivo, TOC com `TABLE DATA`, sequências, ownership, grants/default ACLs, RLS/FORCE, policies, ledger, versões, extensão e dados de proveniência. Publicar no GitHub somente **metadados não sensíveis**, sem dump nem credenciais.
5. Revogar/expirar credenciais de execução após janela e comprovar cleanup; não alterar senha/role sem aprovação própria.

## 4. Restore e rollback: gates separados

O clone `br-sweet-union-b6j80a7j` possui um database alvo `iam_canonical_validation` ainda vazio, sem `pgcrypto` instalada. O grafo de roles da branch difere da origem; roles são escopo **branch-wide** e alterações impactam outros databases do clone. Instalação de `pgcrypto`, reconciliação de roles, `pg_restore`, ensaio de rollback e validação pós-COMMIT exigem **aprovações independentes próprias**, cada uma com plano de restauração, evidência e rollback. Nenhuma delas decorre da aprovação deste documento ou da aprovação do backup.

## 5. Protocolo de decisão independente na Issue #94

O revisor `alexoaraujo83` deve publicar **ele mesmo**, após verificação de todas as condições:

- **Aprovação operacional:** `G1_FULL_BACKUP_OWNER_APPROVED`, identificando branch ID, banco, role, host, prazo, SHA, controle de custódia e escopo **somente backup no clone**; ou
- **Rejeição / pendência:** `G1_FULL_BACKUP_OWNER_REJECTED` ou `G1_FULL_BACKUP_OWNER_CONDITIONAL_APPROVAL`, listando pendências, **sem autorizar execução**.

A aprovação do código desta PR, reactions, aprovação de outro Environment (`preflight/NO_DDL`) ou comentário do operador **não substituem** essa decisão. Se o clone expirar, **qualquer decisão anterior perde validade** e exige novo clone, revalidação e nova aprovação.

## 6. Critérios de aceitação da PR

- [ ] Documento revisto independentemente, sem secrets ou dados de usuários.
- [ ] Issue #94 vinculada e revisor designado.
- [ ] Checks de documentação/segurança do GitHub aprovados no SHA da PR.
- [ ] Nenhum workflow de backup acionado por esta PR; nenhuma configuração de Production alterada.
- [ ] **Gate operacional permanece `BLOCKED` até evidência real e aprovação independente na Issue #94.**

**Princípio PEOS:** Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar; sem ultrapassar gates bloqueados.
