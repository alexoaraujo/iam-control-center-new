# Contratos de domínio IAM — proposta para revisão

**Status:** proposta arquitetural; ainda não aprovada  
**Escopo:** identidade externa, tenant, membership, permissões e auditoria  
**Não é:** migration SQL, autorização implementada ou evidência de RLS funcional

## 1. Objetivo e critérios

Estabelecer contratos explícitos antes de criar endpoints ou migrations executáveis. Esta proposta complementa `docs/architecture/overview.md` e `SECURITY.md`.

Requisitos de segurança já documentados no repositório:
- A identidade externa é identificada por `(issuer, subject)`; email é atributo mutável, não chave estável.
- O browser não é fonte autoritativa para tenant, role ou permission.
- A aplicação nega por padrão e valida sessão, membership ativa, escopo do recurso e permissão no servidor.
- Primeiro login não cria tenant, membership nem papel privilegiado automaticamente.
- O runtime PostgreSQL não pode ser owner, superuser nem ter `BYPASSRLS`.
- Nenhuma migration é aplicada nesta etapa.

## 2. Contratos propostos

### 2.1 External identity

| Campo conceitual | Contrato |
|---|---|
| `id` | Identificador interno opaco, preferencialmente UUID, imutável |
| `issuer` | Valor `iss` validado do provedor OIDC, normalizado de forma consistente |
| `subject` | Valor `sub` validado; tratado como string opaca e sensível a maiúsculas/minúsculas |
| `email` | Atributo de perfil opcional e mutável; nunca chave de identidade |
| `email_verified` | Atributo informativo do provedor; não concede acesso por si só |
| timestamps | Datas de criação/atualização em UTC, geradas pelo servidor |

**Invariante:** unicidade composta em `(issuer, subject)`. Não vincular automaticamente identidades diferentes por email. Atualização de email não altera a identidade interna.

### 2.2 Tenant

| Campo conceitual | Contrato |
|---|---|
| `id` | Identificador interno opaco, imutável |
| `name` | Nome de exibição; não é identificador de segurança |
| `slug` | Identificador legível opcional, normalizado e único conforme regra aprovada |
| `status` | Estado explícito, por exemplo `active` ou `suspended` |
| timestamps | Datas de criação/atualização em UTC |

**Invariante:** o tenant é criado por fluxo administrativo explícito e auditável. Não derivar o tenant de email, domínio de email ou parâmetros fornecidos pelo browser. A suspensão bloqueia novas operações protegidas desse tenant.

### 2.3 Membership

Membership representa o vínculo entre uma identidade local e um tenant. Uma identidade pode pertencer a vários tenants; cada tenant pode ter várias identidades.

| Campo conceitual | Contrato |
|---|---|
| `id` | Identificador interno opaco, imutável |
| `tenant_id` | Tenant proprietário do vínculo |
| `identity_id` | Identidade local vinculada |
| `status` | `invited`, `active`, `suspended` ou `revoked` |
| `created_by` | Ator que originou o vínculo, quando conhecido |
| timestamps | Datas de criação/atualização em UTC |

**Invariantes:**
- Unicidade de `(tenant_id, identity_id)`, incluindo memberships não ativas; reativar o vínculo existente em vez de criar duplicatas.
- Somente membership `active` autoriza a avaliação de permissões do tenant.
- Convites e ativações exigem fluxo explícito, autorização apropriada e evento de auditoria.
- Não existe membership implícita apenas porque a pessoa autenticou no Auth0.

### 2.4 Permissions e roles

Permission é um identificador estável no formato `resource.action`, por exemplo `iam.control_center.read`. O nome é um contrato da aplicação, não uma claim confiável recebida do browser.

| Conceito | Contrato |
|---|---|
| Permission | Identificador único e documentado; sem curingas implícitos |
| Role | Conjunto nomeado de permissions, com escopo explícito |
| Membership-role assignment | Vínculo entre membership e role, limitado ao tenant quando a role for tenant-scoped |
| Avaliação | Executada no servidor para cada operação protegida |

**Regras:**
- Negar por padrão: ausência de permission, contexto incompleto ou erro de resolução resulta em negação.
- Separar roles globais de roles de tenant se/quando houver necessidade; não criar um superadmin global nesta migration inicial sem requisito aprovado.
- Não confiar em `role`, `tenant_id` ou permission enviados pelo cliente.
- Mudanças em atribuições privilegiadas devem gerar auditoria.
- A matriz inicial de roles e permissions deve ser revisada separadamente antes de popular dados.

### 2.5 Audit events

Eventos de auditoria devem registrar, no mínimo, tipo do evento, horário, ator quando conhecido, tenant relevante, resultado e identificador de correlação. Não registrar tokens, cookies, segredos, códigos de autorização ou dados pessoais desnecessários.

A proposta de retenção, imutabilidade e acesso aos eventos requer decisão separada antes da migration.

## 3. Contrato de autorização server-side

Para cada operação protegida, seguir esta ordem:

1. Validar a sessão OIDC no servidor e a integridade/validade das claims necessárias.
2. Resolver a identidade local pela chave `(iss, sub)`.
3. Resolver o tenant por identificador interno conhecido pela aplicação; nunca confiar apenas no slug recebido sem resolução/autorização.
4. Confirmar que o tenant está ativo e que a membership correspondente está `active`.
5. Resolver a permission exigida e validar o escopo do recurso dentro do tenant.
6. Executar a operação com contexto tenant-scoped e aplicar isolamento no PostgreSQL como defesa em profundidade.
7. Emitir evento de auditoria para resultado de segurança relevante, sem dados secretos.

Respostas HTTP exatas (401/403/404), prevenção de enumeração e contrato dos endpoints serão definidos ao desenhar cada endpoint.

## 4. Contrato de isolamento PostgreSQL a validar depois

- Toda tabela de negócio tenant-scoped deve ter associação explícita ao tenant.
- RLS deve cobrir leitura e escrita, com políticas testadas para operações permitidas e negadas.
- O contexto do tenant deve ser definido pelo servidor dentro da transação; não aceitar um valor de sessão definido diretamente pelo cliente.
- O runtime role deve ser não proprietário, não superuser e sem `BYPASSRLS`, `CREATEDB` ou `CREATEROLE`.
- Testes negativos devem demonstrar que uma sessão de tenant A não lê nem altera dados do tenant B, inclusive por identificadores conhecidos.
- A configuração efetiva de grants, policies e privilégios deve ser inspecionada sob o runtime role real, não apenas sob o owner.

Este documento não declara RLS configurada nem testada.

## 5. Decisões necessárias antes da migration

| ID | Decisão pendente | Proposta inicial |
|---|---|---|
| IAM-DC-01 | Formato dos IDs internos | UUID gerado no servidor |
| IAM-DC-02 | Normalização do issuer | Armazenar o issuer validado de forma consistente; não remover barra final sem regra explícita |
| IAM-DC-03 | Tenant slug | Opcional; normalização e reutilização após suspensão precisam de decisão |
| IAM-DC-04 | Reativação de membership | Reativar o vínculo existente, preservar histórico de eventos |
| IAM-DC-05 | Modelo de roles | Roles tenant-scoped; roles globais fora do escopo inicial |
| IAM-DC-06 | Permission catalog inicial | Aprovação explícita da matriz antes de seed/migration |
| IAM-DC-07 | Auditoria | Definir eventos, acesso e retenção antes de implementação |
| IAM-DC-08 | Contexto RLS | Definir mecanismo transacional e testar contra spoofing antes de liberar tabelas tenant-scoped |

## 6. Gate para produzir a migration inicial

Somente depois da revisão deste contrato:
1. Registrar decisões aceitas e mudanças solicitadas.
2. Preparar uma migration SQL nova e pequena, com número/nome rastreável; não copiar cegamente protótipos.
3. Criar testes de aplicação/idempotência, concorrência e recuperação em PostgreSQL isolado.
4. Criar testes de grants, policies RLS e isolamento cross-tenant sob a role runtime real.
5. Validar a migration em Development/Preview isolados e anexar logs sanitizados, run ID e SHA.
6. Não aplicar em Production sem aprovação explícita, plano de recuperação e evidência revisada.

## 7. Critérios de aceite deste documento

- [ ] Contrato de identidade e unicidade `(issuer, subject)` revisado.
- [ ] Estados e transições de tenant/membership aprovados.
- [ ] Catálogo inicial de permissions e modelo de roles aprovados.
- [ ] Requisitos de auditoria e isolamento aprovados.
- [ ] Decisões IAM-DC-01 a IAM-DC-08 resolvidas ou explicitamente adiadas.
- [ ] Nenhuma migration ou alteração de banco aplicada nesta etapa.

