# ADR-0003 — Descoberta de tenant e catálogos globais

- Estado: **proposta para revisão; não aprovada como contrato definitivo**.
- Data: 2026-10-26
- Projeto: IAM Control Center
- Repositório: `alexoaraujo83/iam-control-center`
- PR: [#27 — Draft](https://github.com/alexoaraujo83/iam-control-center/pull/27)
- Dependências: [ADR-0002 — Tenant-scoped RBAC](0002-tenant-scoped-rbac.md) e [proposta RLS](../../security/rls-design-proposal-2026-10-26.md).

## Contexto

O catálogo read-only de Development e Preview confirma que `iam.tenants`, `iam.identities` e `iam.permissions` não têm RLS habilitado, enquanto o runtime possui SELECT nessas tabelas. A tabela `iam.role_permissions` não possui `tenant_id`; seu escopo deve derivar da role relacionada. O helper `app_private.current_tenant_id()` lê o GUC `app.tenant_id`, que não constitui prova de identidade.

A decisão precisa preservar o fluxo inicial de login, impedir descoberta irrestrita de tenants e manter o RBAC como fonte autoritativa de permissões.

## Decisões propostas para revisão

### 1. Descoberta e seleção de tenant

1. A identidade local é resolvida exclusivamente após validação do token OIDC pela aplicação: assinatura, issuer, audience, expiração e claims necessários.
2. A chave da identidade é o par exato `(issuer, subject)`; e-mail não é chave de identidade.
3. A descoberta normal retorna somente tenants com membership `active` e tenant `active`. Memberships `invited` são tratadas por um fluxo de convite separado e não concedem acesso normal.
4. Memberships `suspended` ou `revoked`, e tenants `suspended` ou `deleted`, não autorizam acesso normal.
5. O tenant enviado pelo cliente é apenas um seletor. O backend precisa verificar a membership ativa daquela identidade para o tenant selecionado em cada novo contexto autenticado.
6. Não conceder ao runtime SELECT irrestrito em `iam.tenants` como mecanismo de descoberta. Preferir uma consulta parametrizada controlada ou função de escopo mínimo que retorne somente tenants elegíveis à identidade autenticada.
7. Antes de implementar uma função, revisar separadamente owner, `SECURITY DEFINER` (se necessária), `search_path` fixo, EXECUTE grants, exposição de erros e testes negativos. Nenhuma função é criada nesta ADR.

### 2. `iam.identities`

1. O fluxo de login deve localizar a identidade por `(issuer, subject)`, nunca por e-mail.
2. O runtime não deve receber acesso amplo a campos de perfil que não sejam necessários ao fluxo.
3. A estratégia de lookup/upsert precisa ser compatível com o isolamento e com concorrência; não confiar em issuer/subject colocados em GUCs como prova de OIDC.
4. A criação ou atualização de identidade deve ocorrer somente após validação OIDC na camada de aplicação e usar queries parametrizadas ou uma interface de banco controlada.
5. O desenho final de privilégios/RLS fica bloqueado até que o caminho de bootstrap de login seja testado com credencial runtime real.

### 3. `iam.permissions`

1. Tratar `iam.permissions` como catálogo global de definições de permissões, não como concessões de acesso.
2. Proposta inicial: permitir leitura apenas das colunas de metadados necessárias ao backend, após revisão do conteúdo real e da necessidade; não conceder escrita ao runtime comum.
3. A posse de uma chave de permissão no catálogo não autoriza uma identidade. A autorização efetiva continua sendo membership ativa no tenant → roles dessa membership → `iam.role_permissions` → `iam.permissions.key`.
4. Se o catálogo contiver metadados sensíveis ou administrativos, retirar SELECT direto e disponibilizar somente interface de leitura controlada. Confirmar o conteúdo antes de implementar.

### 4. Contexto tenant e RLS

1. Resolver identidade e membership antes de estabelecer contexto tenant-scoped.
2. Definir o contexto dentro da transação que executa as consultas protegidas e limpá-lo/encerrá-lo corretamente antes de reutilizar a conexão.
3. Não considerar `app.tenant_id` como credencial ou prova de autorização; o caller SQL pode tentar alterá-lo.
4. Runtime deve ser não proprietário, sem `BYPASSRLS`, sem privilégios DDL e sem credenciais de migrator.
5. Se a ameaça incluir execução de SQL arbitrário com a credencial runtime, o GUC sozinho é insuficiente. Esse risco precisa ser mitigado e testado antes de declarar isolamento aprovado.

## Testes obrigatórios

| Cenário | Resultado esperado |
|---|---|
| Identidade validada sem membership | Nenhum tenant normal descoberto |
| Membership `invited` | Visível apenas no fluxo de convite, sem acesso normal |
| Membership `suspended` ou `revoked` | Sem autorização efetiva |
| Tenant `suspended` ou `deleted` | Não aparece na descoberta normal e não autoriza acesso |
| Tenant A selecionado com membership somente em B | Negado |
| Identidades com memberships ativas em A e B | Descoberta retorna somente A e B |
| Busca de identidade por e-mail | Não usada como chave de autorização |
| GUC ausente/vazio/malformado | Falha fechada e sem vazamento cross-tenant |
| Tentativa de alterar GUC via SQL | Não tratada como prova de identidade; ameaça explicitamente testada |
| Reuso de conexão/pool entre tenants | Nenhum contexto anterior persiste |
| Runtime real sem privilégio de owner | Fluxo de login, leitura RBAC e negações testados |
| Escrita/DDL pelo runtime comum | Negada |

## Evidência e limites

- A revisão do GitHub Actions `quality` no SHA `1f0be103ec71eaa4643f6e0c5f97640e982eaa40` terminou com sucesso em duas execuções; o check Vercel Preview Comments também terminou com sucesso. Isso valida o commit de documentação/código coberto pelo pipeline, não o comportamento real do PostgreSQL.
- O Preview Vercel foi reportado como Ready para esse SHA; isso não comprova RLS nem autenticação de runtime no Neon.
- A inspeção anterior foi somente leitura em Development e Preview.
- O SQL original das migrations 0001 e 0002 continua não recuperado; strings de checksum do ledger não são hashes verificados dos arquivos SQL.
- Nenhuma migration, DDL, DML, alteração de role/grant ou acesso a Production está autorizado por este documento.

## Próximas etapas seguras

1. Manter PR #27 Draft e não mesclar.
2. Revisar esta ADR e aprovar/alterar as decisões de produto explicitamente.
3. No branch Neon isolado, testar com credencial real não proprietária o fluxo de descoberta e leitura RBAC.
4. Recuperar as migrations originais ou documentar formalmente uma estratégia de baseline.
5. Só após aprovação de segurança, propor SQL versionado e testes de isolamento em PR separado; não executar em Production sem autorização explícita.
