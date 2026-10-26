# Proposta de desenho RLS para RBAC multi-tenant

- Data: 2026-10-26
- Projeto: IAM Control Center
- Repositório: `alexoaraujo83/iam-control-center`
- PR: [#27 — Draft](https://github.com/alexoaraujo83/iam-control-center/pull/27)
- Base de evidência: catálogo read-only de Development e Preview, documentado em `docs/evidence/rbac-schema-catalog-verification-2026-10-26.md`
- Estado: **proposta para revisão; não aplicada**.
- Restrições desta etapa: sem DDL/DML, sem migrations, sem alteração de grants/roles, sem acesso ou alteração de Production.

## 1. Evidência técnica de entrada

Em Development (`br-mute-pine-b6lc6bip`) e Preview (`br-lucky-fog-b6vv08bq`), ambas no banco `neondb`:

- RLS e FORCE RLS estão ativos em `audit.events`, `iam.invitations`, `iam.memberships` e `iam.membership_roles`.
- RLS está desabilitado em `iam.roles`, `iam.role_permissions`, `iam.tenants`, `iam.identities` e `iam.permissions`.
- A função `app_private.current_tenant_id()` retorna `NULLIF(current_setting('app.tenant_id', true), '')::uuid`.
- As políticas tenant existentes comparam `tenant_id` com essa função.
- `iam.role_permissions` não possui `tenant_id`; o tenant deve ser determinado pela role referenciada.
- O runtime tem SELECT em `iam.roles`, `iam.role_permissions`, `iam.tenants` e `iam.permissions`. O catálogo não prova autenticação real do login runtime.

## 2. Objetivos de segurança

1. Negar acesso por padrão quando não há contexto válido.
2. Evitar que uma associação de membership ou role atravesse tenants.
3. Manter o RBAC autoritativo: identidade OIDC validada → membership ativa no tenant → roles da membership → permissões das roles.
4. Separar leitura de catálogos globais da autorização para recursos tenant-scoped.
5. Preservar o fluxo de login/descoberta de tenants sem conceder listagem irrestrita de dados.
6. Manter a role runtime sem propriedade de objetos, sem `BYPASSRLS` e sem DDL.
7. Testar comportamento com credenciais reais de runtime, não apenas `SET ROLE` a partir de uma sessão administrativa.

## 3. Proposta por tabela

### `iam.roles`

**Política de leitura tenant-scoped proposta:**
- Permitir SELECT somente quando `tenant_id = app_private.current_tenant_id()`.
- Habilitar RLS e FORCE RLS na futura migration.
- Não conceder INSERT/UPDATE/DELETE ao runtime por padrão. Operações de administração de roles devem ser definidas separadamente, com autorização de aplicação e políticas `WITH CHECK` específicas.

**Predicado conceitual (não executável nesta etapa):**

```sql
tenant_id = app_private.current_tenant_id()
```

### `iam.role_permissions`

Como a tabela não contém `tenant_id`, filtrar por associação à role e pelo tenant dessa role:

**Política de leitura tenant-scoped proposta:**
- Habilitar RLS e FORCE RLS.
- SELECT permitido apenas se existir uma linha em `iam.roles` com `roles.id = role_permissions.role_id` e `roles.tenant_id = app_private.current_tenant_id()`.
- O runtime permanece sem escrita nesta tabela até existir requisito de produto e um contrato explícito de autorização administrativa.
- A futura implementação deve avaliar a interação da subconsulta com RLS de `iam.roles`, permissões de execução e planos de consulta; não presumir que o predicado isolado já está validado.

**Predicado conceitual (não executável nesta etapa):**

```sql
EXISTS (
  SELECT 1
  FROM iam.roles r
  WHERE r.id = role_permissions.role_id
    AND r.tenant_id = app_private.current_tenant_id()
)
```

### `iam.tenants` — descoberta e seleção

Não aplicar simplesmente a política de tenant atual para toda leitura: durante a descoberta inicial, o tenant ainda pode não estar selecionado.

Alternativa preferida para revisão:
- remover leitura ampla direta do runtime, caso seja confirmada como desnecessária;
- disponibilizar uma consulta ou função de descoberta que retorne apenas tenants nos quais a identidade autenticada possui membership elegível;
- exigir que a aplicação valide o issuer/subject OIDC e confirme a membership antes de estabelecer o contexto tenant-scoped;
- definir explicitamente se memberships `invited` aparecem no fluxo de convite, sem tratá-las como memberships autorizadas para acesso normal;
- definir comportamento para tenants `suspended` ou `deleted`.

A função/consulta de descoberta, se adotada, requer revisão própria de SECURITY DEFINER, owner, `search_path`, grants e proteção contra execução não autorizada. Não criar função nesta etapa.

### `iam.identities` — catálogo global de identidade

A chave de identidade é `(issuer, subject)`, não e-mail. A consulta de identidade durante OIDC login precisa ser compatível com o isolamento.

Antes de propor RLS:
- especificar como a aplicação faz lookup/upsert após validar tokens;
- restringir o acesso direto de runtime aos campos estritamente necessários;
- avaliar consulta parametrizada ou função controlada para resolver a identidade;
- não presumir que um GUC de issuer/subject fornecido pela própria conexão SQL seja uma prova criptográfica de identidade.

### `iam.permissions` — catálogo global de permissões

A tabela contém chaves de permissão globais. Proposta inicial:
- decidir formalmente se a leitura do catálogo de definições é pública para o backend autenticado ou limitada a um endpoint controlado;
- se for metadado não sensível, manter leitura global somente após confirmar conteúdo e necessidade; caso contrário, retirar SELECT direto e expor leitura limitada;
- mudanças no catálogo e nas associações de permissões ficam fora do runtime comum.

A leitura de `iam.permissions` não concede, por si só, a permissão correspondente; a autorização efetiva deriva das associações membership → role → role_permissions → permissions.

## 4. Limitação do contexto GUC — bloqueador de segurança

`app_private.current_tenant_id()` lê `app.tenant_id` com `current_setting`. Um GUC customizado não é, por si só, um mecanismo de autenticação: uma sessão SQL com capacidade de emitir comandos pode tentar alterar a variável.

Requisitos para o desenho final:
- a API deve validar assinatura, issuer, audience, expiração e demais claims necessários do token OIDC;
- a API deve resolver a identidade local e verificar membership ativa no tenant selecionado;
- o contexto deve ser estabelecido somente após essas validações e sempre dentro do escopo correto da transação/conexão, evitando vazamento entre requisições em pool;
- não expor conexão SQL arbitrária ao cliente final;
- proteger consultas contra SQL injection e usar queries parametrizadas;
- runtime deve ser não proprietário, sem `BYPASSRLS`, sem privilégios de migração;
- se a ameaça inclui SQL arbitrário executado com a credencial runtime, não declarar o GUC uma barreira suficiente. Avaliar um desenho que não dependa apenas de contexto definido pelo próprio caller, além de limitar a capacidade e o alcance dessa credencial.

RLS é defesa em profundidade e não substitui autenticação OIDC nem autorização de aplicação.

## 5. Matriz de testes necessária antes de migration

| Caso | Resultado esperado |
|---|---|
| Sem `app.tenant_id` | Nenhuma linha tenant-scoped visível; acesso negado por padrão |
| Tenant A selecionado | Apenas roles de A visíveis |
| Leitura de role_permissions com tenant A | Somente permissões de roles de A |
| Tentativa de atribuir role de B a membership de A | Negada por constraints/policies |
| INSERT/UPDATE cross-tenant | Negado |
| Membership `suspended` ou `revoked` | Sem autorização efetiva |
| Tenant `suspended` ou `deleted` | Sem acesso normal, conforme contrato aprovado |
| Identidade sem membership | Nenhum tenant elegível retornado |
| Identidade com memberships em A e B | Descoberta retorna somente A/B autorizados; seleção valida a membership correspondente |
| GUC ausente/vazio/malformado | Falha fechada; comportamento documentado e testado |
| Reuso de conexão em pool entre tenants | Contexto da requisição anterior não pode vazar |
| Credencial real `iam_app_runtime_login` | Teste feito sem depender de privilégios do owner |
| Tentativa de DDL pela role runtime | Negada |
| SQL arbitrário tentando trocar GUC | Risco documentado; não tratar GUC como prova de identidade |

## 6. Fluxo de trabalho GitHub → Vercel → Neon

1. Manter esta proposta no PR #27 Draft; sem merge.
2. Obter aprovação do CI para o SHA que inclui este documento.
3. Revisar e aprovar o contrato de descoberta de tenant, identidade global e catálogo global.
4. Criar/usar branch Neon isolada para validar políticas e testes com credencial runtime real.
5. Guardar SQL de teste, resultados, branch ID, commit SHA e limitações como evidência.
6. Somente após aprovação de segurança, preparar migration versionada em outro commit/PR revisável.
7. GitHub Actions deve executar quality/testes e checagens estáticas; Preview Vercel valida o app, mas não comprova isolamento real do PostgreSQL.
8. Nenhuma migration em Production nem deploy de Production sem autorização explícita.

## 7. Estado da decisão

- RBAC autoritativo: aceito pelo usuário.
- RLS em `iam.roles` e `iam.role_permissions`: proposta, não aplicada.
- Descoberta de tenants: decisão pendente.
- Política para `iam.identities`: decisão pendente.
- Política para `iam.permissions`: decisão pendente.
- Teste com credencial real runtime: pendente.
- Recuperação de SQL original das migrations 0001/0002 ou decisão formal de baseline: pendente.
- Migrations executáveis: não criadas/não executadas nesta etapa.
- Production: intocada.
