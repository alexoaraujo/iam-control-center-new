# Proposta de migration corretiva — contexto confiável e isolamento IAM

**Status:** proposta documental para revisão; não aprovada, não executável e não aplicada  
**Branch:** proposal/iam-context-migration-review  
**Base:** main — SHA observado c0323194be7962cd9a641418e0746715a8bf2b82  
**Escopo:** preparar uma futura migration corretiva separada, com foco na fronteira de confiança do contexto de tenant, privilégios efetivos e recuperação segura.  
**Regra de segurança:** este documento não autoriza execução SQL, alteração de roles, aplicação no Neon, mudança Auth0/Vercel ou deploy.

## 1. Objetivo

Definir os requisitos e os gates de aprovação para corrigir as limitações identificadas na migration 0001_initial_iam_schema.sql, preservando os contratos IAM existentes e evitando que um GUC controlável pela sessão seja tratado como prova de autorização.

A futura mudança deverá:

1. manter Auth0 como provedor de identidade OIDC;
2. identificar a identidade pelo par validado (issuer, subject);
3. exigir membership ativa no tenant e autorização server-side para cada operação;
4. estabelecer uma fronteira confiável entre a aplicação, o contexto de tenant e as policies RLS;
5. restringir privilégios por papel PostgreSQL e por ambiente;
6. preservar dados existentes e registrar versão/checksum da migration;
7. demonstrar os controles com a role efetiva de runtime em PostgreSQL e, depois, em branch Neon isolada.

## 2. Fora de escopo e bloqueios explícitos

Esta proposta não escolhe HMAC, assinatura assimétrica, extensão PostgreSQL ou broker como solução final; não define bootstrap automático de identidade; não altera a migration 0001; não cria ou altera roles, grants, policies, tabelas, funções ou chaves; não executa SQL em Development, Preview ou Production; não altera Auth0, Vercel, GitHub Secrets ou variáveis de ambiente; e não autoriza promoção de branch, merge, deploy ou alteração de Production.

A decisão criptográfica permanece **PENDING** até validar suporte efetivo do Neon, disponibilidade de extensão ou biblioteca adequada, isolamento do material de chave, modelo de rotação e viabilidade de testes com a role runtime real.

## 3. Evidência e baseline

### 3.1 Evidência do harness local

O harness IAM-CTX-POC-01 está em branch separada e não integra a migration de produção.

| Evidência | Valor |
|---|---|
| Branch do harness | IAM-CTX-POC-01-Harness-draft-0.1 |
| SHA validado | 208b852ed24d8768c4d6db58ce741c88bf5f4f7b |
| Workflow harness | [Run 41536707836](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41536707836) |
| CI principal | [Run 41536707484](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41536707484) |
| Artifact | [13184422300](https://github.com/alexoaraujo83/iam-control-center/actions/runs/41536707836/artifacts/13184422300) |
| SHA-256 do ZIP | 96114f4b324cfed5a78e2f22e578c241cca35c4ae3f7f1d276dcee062471fb64 |
| PostgreSQL reportado | 18.6 (Debian 18.6-1.pgdg13+2) |
| Resultado | 16/16 assertions PASS local |

**Interpretação:** os 16 resultados comprovam somente as assertions implementadas no PostgreSQL 18.6 descartável. Não comprovam assinatura criptográfica, integração OIDC/Auth0, compatibilidade Neon, RLS com a role real Neon, resistência a TOCTOU ou segurança de Production.

O CI principal teve sucesso no SHA do harness, mas o job preview-deployment foi skipped. Não há evidência de deploy Preview decorrente dessa execução.

### 3.2 Fontes arquiteturais consultadas em main

| Fonte | Blob SHA |
|---|---|
| docs/architecture/tenant-context-rfc.md | ee99fd2a9cc10ad83d33c56bc8fe0090e3867d59 |
| docs/architecture/iam-contracts.md | 7164c6751b723f6a9b85a9e887688c6f07371ade |
| database/migrations/0001_initial_iam_schema.sql | 97aad3ef36ca5638c79128fa0a2a47a309824989 |
| database/migrations/README.md | 8a2cb2a8a3fac04f0a805b838c10ae51619f3c79 |

Os documentos-fonte mantêm o contexto assinado como candidato para prototipagem, não como decisão aprovada.

## 4. Contratos IAM que devem ser preservados

### 4.1 Identidade

- Chave lógica: (issuer, subject) obtidos de token OIDC validado no servidor.
- Validar assinatura, iss, aud, exp, iat, nonce quando aplicável e estado da sessão.
- E-mail, nome e email_verified são atributos de perfil; nunca chaves de autorização.
- O identificador Auth0 não deve ser confundido com tenant ou membership.
- Bootstrap/criação de identidade permanece uma decisão separada; o comportamento atual do harness é deny-by-default.

### 4.2 Tenant e membership

- iam.tenants.id é UUID interno imutável; slug é endereçamento, não autorização.
- Tenant deve estar active.
- Membership deve estar active para o tenant solicitado.
- Uma identidade pode ter no máximo uma membership por tenant.
- Estados de membership: invited, active, suspended, revoked.
- Identidade global não implica membership em tenant algum.
- Seleção de tenant enviada pelo navegador não constitui prova de autorização.

### 4.3 Roles e permissions

- Roles são tenant-scoped.
- Vínculos membership-role e role-permission devem preservar as FKs compostas por tenant.
- A autorização efetiva é calculada no servidor com membership ativa, roles e permission key.
- Claims de roles fornecidas pelo browser não são confiáveis.
- Runtime não deve administrar diretamente catálogo de permissões, roles ou atribuições de roles.

### 4.4 Auditoria

- Eventos devem preservar ator, tenant quando aplicável, ação, resultado, instante e request ID.
- Runtime pode inserir eventos, mas não atualizar ou excluir eventos existentes.
- Não registrar tokens OIDC, cookies, segredos, chaves ou payloads integrais de autenticação.

## 5. Divergências e riscos da migration 0001

| Área | Estado observado | Risco / decisão necessária |
|---|---|---|
| Contexto RLS | app_private.current_tenant_id() lê current_setting('app.tenant_id', true) | GUC comum é mutável pela sessão; não é fronteira contra SQL arbitrário com a mesma role. |
| Policies tenant-scoped | RLS habilitada e FORCE ROW LEVEL SECURITY em tabelas tenant-scoped | RLS continua útil como defesa em profundidade, mas a origem do contexto precisa ser confiável. |
| Audit global | Coluna audit.events.tenant_id aceita NULL; policy exige tenant não nulo | Eventos globais sem tenant não passam pela policy atual; definir fluxo explícito e privilégio restrito, sem abrir policy permissiva. |
| Identidades | iam.identities é global e sem RLS | Exige grants mínimos, consultas por issuer/subject e proteção de UPDATE; avaliar exposição de atributos entre tenants. |
| Memberships/invitations | Runtime possui SELECT/INSERT/UPDATE | Validar todas as operações, WITH CHECK, transições de estado, convite e prevenção de escalada. |
| Roles/assignments | Runtime possui SELECT; sem escrita direta prevista | Confirmar que nenhuma função, owner ou grant indireto permite atribuição não autorizada. |
| Permission catalog | SELECT runtime | Confirmar imutabilidade para runtime e governança de alterações por migrator/admin. |
| Audit events | SELECT/INSERT; REVOKE de UPDATE/DELETE/TRUNCATE | Verificar privilégios efetivos, sequences e caminhos indiretos de alteração. |
| Migration ledger | iam.schema_migrations sem acesso runtime | Definir proprietário e executor exclusivos; validar checksum e divergência de versão. |
| Funções privilegiadas | current_tenant_id() recebe EXECUTE; sem verificador confiável | Qualquer futura SECURITY DEFINER exige owner controlado, search_path fixo, objetos qualificados e grants mínimos. |
| Roles efetivas | Migration concede grants se roles existirem | Não inferir que o nome da role representa a role efetiva da conexão; verificar membership de roles, atributos e grants herdados. |

## 6. Alternativas de fronteira confiável

Nenhuma alternativa está aprovada. A seleção exige ADR complementar e protótipo isolado.

| Alternativa | Vantagens | Riscos / perguntas pendentes | Situação |
|---|---|---|---|
| GUC UUID simples | Baixa complexidade e compatível com fluxo atual | Sessão pode falsificar o tenant; não protege contra SQL arbitrário | **Rejeitada para isolamento forte** |
| Contexto assinado verificado no banco | Pode vincular tenant, identity, membership, validade e request; policies podem verificar autenticidade | Biblioteca/extensão disponível? Quem guarda/verifica chave? Rotação, replay, custo por statement, SECURITY DEFINER e pool | **Candidata; não aprovada** |
| Role PostgreSQL por tenant | Fronteira baseada em privilégio do banco | Provisionamento, explosão de roles, pool, troca de tenant, rotação e limites operacionais | **Alternativa a avaliar** |
| Broker confiável de conexão/contexto | Pode concentrar a emissão de contexto e restringir acesso SQL direto | O broker consegue impedir acesso direto da role runtime? Como provar segregação e disponibilidade? | **Alternativa a avaliar** |

### 6.1 Requisitos mínimos caso contexto assinado seja selecionado

O envelope deverá ter versão e campos estritamente definidos, contemplando no mínimo tenant, identity, membership, instante de emissão/expiração e request ID. Campos adicionais, como kid e identificador anti-replay, dependem do desenho final.

A aplicação só poderá emitir contexto após validar o OIDC e autorizar a membership/operação. O banco deverá verificar o contexto antes de permitir que policies o utilizem. Alterar somente o GUC não poderá trocar o tenant autorizado.

O segredo ou chave privada não poderá ser legível pelo runtime. A estratégia de rotação, revogação, expiração e replay deverá ser explícita. Não escolher algoritmo ou extensão antes da prova de compatibilidade e revisão de ameaça.

## 7. Matriz preliminar de privilégios

Esta matriz é um requisito-alvo, não uma declaração de grants já existentes ou criados.

| Papel lógico | Login | Responsabilidade | Privilégios esperados | Proibições |
|---|---:|---|---|---|
| Owner administrativo (iam_owner ou equivalente) | Preferencialmente NOLOGIN para ownership; acesso operacional controlado separado | Ownership de schemas/objetos e administração excepcional | DDL controlado e ownership estritamente necessário | Nunca usado pela aplicação; credencial não disponível no runtime |
| Migrator (iam_migrator) | Executor controlado | Aplicar migrations versionadas | DDL/DML de migração estritamente necessários, em pipeline isolado | Não é runtime; não expor credencial ao browser ou deploy web |
| Runtime (iam_app_runtime) | Sim, por ambiente | Consultas e operações de aplicação | USAGE mínimo; DML somente nas tabelas e colunas necessárias; sem ownership | Sem SUPERUSER, BYPASSRLS, CREATEROLE, CREATEDB, DDL, acesso a segredos ou alteração de funções privilegiadas |
| Verificador de contexto (papel/função dedicada, se necessário) | Preferencialmente NOLOGIN | Verificar contexto e retornar resultado mínimo | Acesso privado estritamente necessário à validação | Não conceder SELECT de chaves ao runtime; não permitir alteração de chaves pelo runtime |

### 7.1 Requisitos para SECURITY DEFINER, se houver

- Owner dedicado, controlado e sem login interativo quando tecnicamente viável.
- search_path fixo e mínimo; schemas e objetos qualificados explicitamente.
- Revogar EXECUTE de PUBLIC e conceder somente aos chamadores necessários.
- Não permitir que parâmetros controlem nomes de objetos, SQL dinâmico ou caminho de busca.
- Validar formato, versão, expiração e erros de forma fail-closed.
- Não retornar material secreto nem detalhes internos sensíveis.
- Revisar recursão de RLS, ownership e comportamento de FORCE RLS.
- Testar tentativa de SET ROLE, execução direta, alteração de objetos e acesso indireto ao segredo.

A implementação não deverá reduzir ou alterar privilégios existentes automaticamente sem inventário e plano separado de reconciliação.

## 8. Pré-condições para futura migration executável

Antes de escrever SQL executável, a revisão deverá aprovar:

1. **Alvo identificado:** branch/database isolado, projeto, branch ID, database e role de conexão documentados.
2. **Estado inicial capturado:** PostgreSQL version, schemas, tabelas, constraints, índices, policies, grants, owners, role attributes e contagens relevantes.
3. **Compatibilidade:** extensões e funções necessárias verificadas no Neon do projeto, sem presumir disponibilidade.
4. **Role efetiva:** conexão de teste realmente autenticada como runtime, sem substituir por Administrador ou owner.
5. **Precondições estruturais:** detectar schema ausente, parcial, divergente ou objetos inesperados; abortar diante de estado desconhecido.
6. **Versão/checksum:** registrar migration ID, checksum do conteúdo e versão anterior esperada.
7. **Concorrência:** impedir duas execuções simultâneas da mesma migration, por mecanismo transacional/lock aprovado.
8. **Idempotência controlada:** segunda execução deve reconhecer versão/checksum já aplicado; checksum divergente deve abortar, não sobrescrever.
9. **Transação:** DDL/DML transacional sempre que suportado; operações não transacionais documentadas e isoladas.
10. **Backup/recuperação:** snapshot ou método de recuperação compatível com o plano gratuito e janela operacional disponível, verificado antes da execução.
11. **Dados:** nenhuma operação destrutiva ou conversão de dados sem contagem, validação, cópia/recuperação e plano de reconciliação.
12. **Aprovação:** revisão de código, CI no SHA candidato, teste isolado e aprovação humana explícita.

A migration corretiva deverá ser nova e separada, por exemplo 0002_iam_trusted_tenant_context, somente após aprovação do desenho. O nome é sugestão e não cria compromisso de implementação.

## 9. Estratégia de recuperação e rollback

A recuperação deverá privilegiar **forward-fix** quando a migration alterar estruturas ou dados que não possam ser revertidos sem perda.

Antes da execução: registrar estado anterior, versão/checksum, owners, grants, policies e contagens; identificar objetos criados/alterados e dependências; definir critérios objetivos para abortar; verificar disponibilidade de snapshot/restore no plano e branch usados; preservar logs sanitizados e evidência de execução.

Durante a execução: falhar fechado em precondição não satisfeita; não apagar nem recriar schemas como estratégia de rollback; não revogar permissões de forma ampla sem medir dependências; registrar cada etapa com request/operation ID sem segredos.

Após a execução: executar smoke tests e matriz negativa com runtime real; comparar contagens e invariantes; validar ledger e checksum; manter a branch isolada até revisão final.

**Rollback não significa executar DROP indiscriminado.** Qualquer reversão deverá ter script separado, análise de dados afetados e aprovação explícita.

## 10. Plano de testes ampliado

O harness atual fornece 16 assertions locais, mas não substitui esta matriz. Os casos abaixo devem ser adicionados em iterações independentes, com evidência por SHA e execução como role efetiva.

| Grupo | Casos obrigatórios | Resultado esperado |
|---|---|---|
| Contexto | ausente, inválido, expirado, adulterado, tenant GUC alterado, versão desconhecida | negação segura; zero vazamento cross-tenant |
| Identidade | issuer diferente, subject diferente, identidade inexistente, bootstrap não autorizado | sem associação implícita por e-mail; deny-by-default |
| Tenant | active, suspended, deleted, tenant inexistente | somente tenant elegível |
| Membership | invited, active, suspended, revoked, membership de outro tenant | somente membership ativa do tenant correto |
| Roles | role de tenant A usada em B, assignment inexistente, assignment revogada | nenhuma autorização cruzada |
| Permissions | permission inexistente, role sem permission, catálogo alterado por runtime | negação e catálogo imutável para runtime |
| Invitations | token errado, hash divergente, expirado, revogado, já aceito, tenant divergente | aceitação única e limitada ao tenant correto |
| INSERT | tenant_id adulterado, FK composta divergente, WITH CHECK | escrita negada sem linha residual |
| UPDATE | troca de tenant, alteração de issuer/subject, promoção de status/role | somente colunas e transições autorizadas |
| DELETE | exclusão de membership, role, invitation e audit | política explícita; audit imutável |
| Auditoria | evento tenant-scoped, evento global, tenant nulo, ator/membership divergente | registro consistente e sem bypass da policy |
| Privilégios | PUBLIC, grants herdados, SET ROLE, owner, BYPASSRLS, sequences, funções | runtime sem escalada ou acesso indireto |
| SECURITY DEFINER | search_path malicioso, objeto homônimo, parâmetro hostil, chamada direta | função não executa objeto não confiável |
| Pool/transação | commit, rollback, conexão reutilizada, duas requisições em sequência | contexto não vaza entre requisições |
| TOCTOU | revogação simultânea à leitura/escrita; suspensão do tenant durante operação | resultado definido por isolamento/locking aprovado |
| Concorrência | duas migrations, duas aceitações de convite, duas atualizações de membership | sem duplicidade ou estado inconsistente |
| Compatibilidade | PostgreSQL local e branch Neon isolada | mesma semântica relevante e diferenças documentadas |

Para cada teste, registrar: ID, SHA, versão PostgreSQL, branch/database, role efetiva, comando, resultado, log sanitizado e limitação. Teste com owner não substitui teste runtime.

## 11. Plano de validação Neon — somente branch isolada

A sequência proposta, após aprovação do desenho:

1. Consultar branches e databases existentes; não criar branch automaticamente.
2. Selecionar uma branch de revisão isolada, sem dados compartilhados relevantes.
3. Confirmar versão PostgreSQL e recursos/extensões realmente disponíveis.
4. Capturar roles, memberships de roles, attributes, owners, grants, RLS e policies.
5. Verificar se o conector permite autenticar como a role runtime real. Se não permitir, marcar **BLOCKED** e preparar um executor controlado separado; não usar Administrador como substituto.
6. Aplicar somente uma migration aprovada e com checksum fixado, após autorização explícita.
7. Rodar testes positivos/negativos e concorrência; salvar logs sanitizados.
8. Descartar ou preservar a branch conforme decisão explícita e limites do plano.

### Limites operacionais do plano gratuito

- Não assumir número ilimitado de branches, retenção, compute, snapshots, restore, extensão ou horas de compute.
- Antes de qualquer branch adicional, conferir limites e recursos efetivamente disponíveis na conta/projeto.
- Evitar compute ativo sem necessidade; não deixar jobs de teste rodando.
- Não conectar secrets Neon ao harness local do GitHub Actions.
- Nenhuma execução em Production está incluída.

## 12. Gates de governança

| Gate | Critério de saída | Estado atual |
|---|---|---|
| G0 — Baseline | contratos, migration 0001 e RFC revisados | **Concluído documentalmente** |
| G1 — Evidência local | harness reproduzível, artifact e SHA verificados | **PASS local 16/16** |
| G2 — Escolha arquitetural | ADR compara contexto assinado, role-per-tenant e broker; decisão criptográfica suportada por evidência Neon | **PENDING** |
| G3 — Privilégios | matriz final, SECURITY DEFINER e role efetiva revisados | **PENDING** |
| G4 — Proposta SQL | migration nova revisável, precondições e recovery plan | **BLOCKED até G2/G3** |
| G5 — Testes locais | matriz ampliada com role não-owner e concorrência | **PENDING** |
| G6 — Neon isolado | compatibilidade e testes com runtime real | **BLOCKED** |
| G7 — PR | revisão humana, CI PASS no SHA exato; Draft até aprovação | **PENDING** |
| G8 — Development/Preview | autorização específica e evidência de execução | **NÃO AUTORIZADO** |
| G9 — Production | aprovação humana explícita e recovery plan | **NÃO AUTORIZADO** |

### Critérios para promover Draft

- Nenhum FAIL aberto em controles obrigatórios.
- Nenhum BLOCKED apresentado como PASS.
- CI e artifact vinculados ao SHA exato.
- Diff limitado e revisado.
- Testes executados com role runtime efetiva.
- Compatibilidade Neon comprovada na branch isolada.
- Revisor humano aprova explicitamente a mudança.

## 13. Próximas ações em ordem segura

1. Revisar esta proposta documental e registrar comentários/decisões.
2. Abrir ADR específico para selecionar a fronteira confiável e a estratégia de chave.
3. Verificar documentação/recursos atuais do Neon para a alternativa selecionada; registrar evidência, sem criar ou alterar recursos.
4. Fechar matriz de privilégios e procedimento de teste como runtime real.
5. Só então redigir a migration 0002 como SQL revisável, com precondições e recovery plan.
6. Executar primeiro em PostgreSQL descartável e depois, mediante autorização, em branch Neon isolada.

**Checkpoint:** nenhum banco, role, secret, configuração externa ou ambiente foi alterado por esta proposta. Nenhum SQL executável foi criado. Production permanece fora do escopo.


## 14. Reconciliação obrigatória com a migration 0001 atual — 03/11/2026

Esta seção supersede os snapshots anteriores das seções 3.1, 3.2 e 5 quando houver divergência. A migration 0001 atual foi inspecionada diretamente na branch `chore/dependencies-refresh-reconciled`.

### 14.1 Baseline real da migration 0001

A migration atual:
- cria os schemas `iam`, `audit` e `app_private`;
- cria as tabelas IAM, audit e o ledger `iam.schema_migrations`;
- habilita e força RLS em nove tabelas de negócio/auditoria: tenants, identities, memberships, roles, permissions, membership_roles, role_permissions, invitations e audit.events;
- **não cria nenhuma policy RLS**;
- **não cria função `app_private.current_tenant_id()` nem qualquer função de verificação de contexto**;
- **não concede grants de runtime**;
- mantém o ledger fora de RLS e sem grants para runtime/PUBLIC;
- não instala extensão, não cria seed data e não escolhe mecanismo criptográfico.

Logo, as referências anteriores a `app.tenant_id`, a uma função `current_tenant_id()`, a policies tenant-scoped existentes ou a grants runtime de SELECT/INSERT/UPDATE/DELETE não descrevem a migration 0001 atual. Elas são snapshots históricos de uma proposta anterior e não devem ser usadas como evidência de comportamento do schema atual.

### 14.2 Consequência de segurança

A baseline atual é **RLS default-deny**. Como não há policies nem grants runtime, a aplicação não tem autorização de dados implementada nesta migration. Isso é intencional até que o contexto confiável, as policies e os grants mínimos sejam aprovados numa migration corretiva separada.

A futura migration 0002 deverá ser projetada a partir deste estado real, sem pressupor policies antigas para remover ou corrigir. Não copiar SQL de protótipos nem executar o harness de contexto como migration.

### 14.3 Contrato de roles e assunção

A migration 0001 exige:
- `iam_owner`, `iam_migrator` e `iam_app_runtime` preexistentes, NOLOGIN e sem atributos administrativos;
- `session_user = iam_migrator_login`, um LOGIN sem atributos administrativos;
- `current_user = iam_owner` imediatamente antes da migration;
- cadeia exata `iam_migrator_login → iam_migrator → iam_owner`, com INHERIT FALSE, SET TRUE e ADMIN FALSE nas duas memberships;
- nenhuma membership direta `iam_migrator_login → iam_owner`;
- ausência de caminho transitivo para `neon_superuser` ou outra role administrativa.

No Neon canônico, o bootstrap de cinco roles e três memberships foi executado somente em Development. Não foi provisionada senha para `iam_migrator_login` nem `iam_app_runtime_login`; conexão real com esses principals permanece BLOCKED. Preview e Production não receberam bootstrap.

### 14.4 Evidência do harness de contexto

O harness IAM-CTX-POC-01 passou 16/16 assertions em PostgreSQL 18 descartável no SHA `a719561443ff542940ef13f9d7b49fa1f0de79da`, workflow run `41645901289`. O harness foi posteriormente integrado à branch de revisão da PR #69; a evidência continua limitada ao SHA/run indicado.

O harness usa um registry opaco local como fixture. Não implementa HMAC, assinatura assimétrica, validação de token OIDC, rotação de chaves, anti-replay ou compatibilidade Neon. A decisão criptográfica continua PENDING. Nenhum resultado do harness autoriza criação de policies, grants, funções SECURITY DEFINER ou execução em Neon.

### 14.5 Fonte de verdade e gates

- Migration atual: `database/migrations/0001_initial_iam_schema.sql`.
- Contrato SQL: `database/tests/0001_schema_contract.sql`.
- Contrato operacional e sequência: `database/migrations/README.md`.
- Estado de pooling: `docs/architecture/neon-connection-pooling.md`; pooler desabilitado nas três branches.
- Estado do cliente Neon: scaffold server-only, sem query real e sem sessão autenticada demonstrada.
- `DATABASE_MIGRATION_URL` está cadastrada no Vercel em Development e Preview segundo inventário sem descriptografia; finalidade/consumidor não comprovados. Não usar no runtime; qualquer remoção exige mudança externa separada.

**Decisão atual:** manter esta PR como proposta documental. Não gerar migration 0002 executável até G2/G3, não alterar roles/grants/policies, não provisionar credenciais e não executar SQL no Neon. Production permanece não autorizada.
