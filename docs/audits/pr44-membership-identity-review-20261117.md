# Auditoria de refatoração — Membership PostgreSQL no comparador canônico (PR #44)

**Data:** 2026-11-17 UTC. **Repositório:** `alexoaraujo/iam-control-center-new`.  
**Base técnica imutável:** [PR #44](https://github.com/alexoaraujo/iam-control-center-new/pull/44), SHA `8bfc89730c45e8b4cf433115ef202148ae086057`. Esta correção é isolada e não reescreve o SHA anteriormente revisado da PR #44.

## Defeito constatado

O comparador `database/offline/compare-schema-manifests.mjs` identificava `role_memberships` por `JSON.stringify(x)`, incluindo todos os atributos. Dois grants PostgreSQL semanticamente idênticos com inserção diferente de propriedades JSON tinham IDs distintos, produzindo **falso drift** `[added]/[missing]`. Pior, uma alteração verdadeira em `admin_option`, `inherit_option` ou `set_option` era considerada dois grants distintos, em vez de **um grant alterado**.

A exportação do schema de `database/scripts/schema-manifest.sql` comprova as colunas: `role`, `member`, `grantor`, `admin_option`, `inherit_option` e `set_option`.

## Mudança implementada

- A identidade passa a ser a tupla JSON ordenada `[role,member,grantor]`, que é estável com diferentes ordens de propriedades e não sofre colisões por nomes de roles que contenham o separador `|`.
- `admin_option`, `inherit_option` e `set_option` continuam no objeto completo comparado por `canonical()`, de modo que drift de privilégio resulta em um único `[changed]`.
- Roles, membros ou grantors ausentes, vazios ou de tipo errado causam **falha fechada** na validação de manifest.
- O relatório continua a mostrar somente a identidade e tipo de drift, sem despejar a DDL do banco, as expressões de policies ou valores secretos.

## Testes de regressão adicionados

1. Reordenar as chaves JSON sem alterar valores **não** produz falso drift.
2. Alterar opções de privilégio de um mesmo grant gera `[changed]` e nunca o descarta.
3. Grants duplicados com a mesma tupla e campos reordenados, ou identidade incompleta, são recusados.
4. Nomes PostgreSQL contendo separadores não colidem na identidade do grant.

**Escopo:** exclusivamente código offline/sem conexão; não altera SQL do banco, constraints, secret, credencial, ACL real, Neon Production ou Vercel. O check PostgreSQL 18 deve executar os testes via `database/tests/run.sh`. O `security-gate` integrado e `protect-main` continuam obrigatórios para qualquer merge; nenhum FAIL ou SKIPPED será considerado PASS.
