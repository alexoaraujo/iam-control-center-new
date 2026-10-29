# Contrato de ciclo de vida do usuário Auth0 — proposta para revisão

**Status:** proposta documental; não aprovada como implementação  
**Escopo:** registro, login OIDC, sessão da aplicação, perfil, identidade interna e auditoria  
**Não é:** prova de login funcional, configuração aplicada no dashboard Auth0, migration SQL ou autorização multi-tenant implementada

## 1. Objetivo

Definir o comportamento esperado para registro e login no IAM Control Center sem confundir uma conta Auth0 com uma identidade interna, membership de tenant ou autorização. Este contrato complementa `docs/architecture/iam-domain-contracts.md`.

## 2. Fontes de identidade e invariantes

- O provedor de identidade esperado é o tenant Auth0 configurado para o ambiente. O emissor OIDC esperado é `https://iam-control-center.us.auth0.com/`; o backend deve comparar o valor `iss` validado com o emissor configurado para aquele ambiente.
- A chave externa é o par exato `(issuer, subject)`, derivado de claims OIDC validadas. `sub` é uma string opaca; não a decompor nem a substituir por e-mail.
- E-mail, `name`, `nickname` e `picture` são atributos de perfil mutáveis, não chaves de identidade.
- Um perfil recebido do browser ou um JSON copiado manualmente não é prova de autenticação. A aplicação só confia na sessão validada pelo SDK no servidor.
- Autenticação bem-sucedida não concede tenant, membership, role nem permission automaticamente.
- Não criar tenant nem usuário privilegiado por inferência de e-mail, domínio, nickname ou primeira autenticação.

## 3. Registro e login

1. O usuário inicia o fluxo em `/auth/login`; o SDK oficial Auth0 inicia o fluxo OIDC.
2. A disponibilidade de registro depende da Universal Login e das conexões habilitadas no tenant Auth0. A aplicação não deve criar um fluxo OAuth/OIDC paralelo.
3. O Auth0 processa a autenticação e retorna ao callback configurado no SDK. A URL de callback precisa corresponder exatamente à configuração permitida no tenant.
4. O SDK valida/processa a resposta e estabelece a sessão da aplicação conforme sua configuração server-side.
5. A aplicação lê a sessão no servidor e extrai apenas os atributos necessários para a interface.
6. Ao resolver a identidade interna, procurar por `(issuer, subject)`. Se não existir, a criação da identidade local só pode ocorrer após validar a sessão e deve ser idempotente; não cria tenant ou membership.
7. Cada recurso protegido exige uma decisão de autorização server-side independente.
8. O logout deve usar o endpoint do SDK e os Allowed Logout URLs configurados para o ambiente.

## 4. Perfil exibível

| Campo | Uso permitido | Restrição |
|---|---|---|
| `sub` | Identificador externo para resolução server-side | Não expor desnecessariamente na interface; nunca usar isoladamente sem emissor |
| `iss` | Validar e compor a chave externa | Usar apenas o emissor validado/configurado |
| `name` | Nome de exibição, se presente | Opcional e mutável |
| `nickname` | Apelido de exibição, se presente | Opcional e mutável |
| `email` | Exibição/contato, se presente | Não é chave de identidade; validar `email_verified` quando a política exigir |
| `email_verified` | Sinal informativo do provedor | Não concede acesso por si só |
| `picture` | Avatar opcional | URL externa; não tratar como confiável nem carregar como conteúdo privilegiado |
| `updated_at` | Exibição administrativa quando necessário | Não equivale a cadastro nem a último login |
| `created_at`, `last_login`, `logins_count`, `blocked` | Dados administrativos quando disponíveis | Não presumir que estejam nas claims da sessão; buscar pela fonte administrativa autorizada quando necessário |

A página de perfil deve renderizar dados obtidos da sessão server-side. Não deve aceitar um objeto de perfil enviado pelo browser como fonte autoritativa.

## 5. Sessão e dados sensíveis

- Manter `AUTH0_CLIENT_SECRET` e `AUTH0_SECRET` exclusivamente em variáveis server-side, com valores próprios por ambiente.
- Não usar prefixo `NEXT_PUBLIC_` para segredos, tokens, issuer privado ou material de sessão.
- Não registrar access tokens, ID tokens completos, refresh tokens, cookies, códigos de autorização, client secrets ou `AUTH0_SECRET` em logs, analytics, mensagens de erro ou eventos de auditoria.
- Retornar erros genéricos ao browser; detalhes técnicos ficam em logs controlados, sem credenciais.
- Não armazenar tokens Auth0 no PostgreSQL como substituto da sessão do SDK.
- Configurar callback, logout e web origins separadamente para Development, Preview e Production; não presumir que um alias de Preview exista sem confirmar no projeto Vercel.

## 6. Identidade local, tenant e membership

- A identidade local tem identificador interno opaco, preferencialmente UUID, e unicidade em `(issuer, subject)`.
- Sincronizar atributos de perfil não altera a chave da identidade e não deve substituir uma identidade existente por coincidência de e-mail.
- Primeiro login pode, após validação server-side, criar apenas a identidade local se a implementação aprovada adotar esse comportamento.
- Membership exige convite, provisionamento administrativo ou outro fluxo explicitamente autorizado e auditável.
- Apenas tenant ativo + membership ativa + permission explícita + escopo do recurso válido permitem uma operação protegida.
- Falha ao resolver identidade, tenant, membership, permission ou contexto de autorização resulta em negação por padrão.

## 7. Eventos de auditoria

Planejar eventos separados para login bem-sucedido/falha, logout, criação/sincronização da identidade local, convite/ativação/revogação de membership e decisões de autorização relevantes. Cada evento deve incluir timestamp UTC, tipo, resultado, ator/identidade quando conhecido, tenant quando aplicável e correlation ID.

Não registrar segredos, tokens, cookies, códigos de autorização ou atributos pessoais desnecessários. A retenção, acesso e imutabilidade dos eventos precisam de decisão própria antes da migration.

## 8. Critérios de aceitação verificáveis

| ID | Critério | Evidência exigida | Estado inicial |
|---|---|---|---|
| AUTH-LC-01 | Login inicia pelo SDK oficial | Teste de rota e configuração por SHA | PENDENTE |
| AUTH-LC-02 | Callback funciona no domínio permitido do ambiente | Teste E2E autorizado + URL de callback exata | PENDENTE |
| AUTH-LC-03 | Sessão é lida somente no servidor | Teste automatizado e revisão do código | PENDENTE |
| AUTH-LC-04 | Logout encerra sessão e retorna a URL permitida | Teste E2E autorizado | PENDENTE |
| AUTH-LC-05 | Identidade usa `(issuer, subject)` | Testes de unicidade, issuer diferente e subject diferente | PENDENTE |
| AUTH-LC-06 | E-mail alterado não cria nova identidade nem transfere vínculo | Testes de regressão | PENDENTE |
| AUTH-LC-07 | Primeiro login não cria tenant/membership/role privilegiada | Testes negativos | PENDENTE |
| AUTH-LC-08 | Ausência de tenant/membership/permission nega acesso protegido | Testes de autorização | PENDENTE |
| AUTH-LC-09 | Logs e erros não expõem tokens ou segredos | Testes/revisão de logs | PENDENTE |
| AUTH-LC-10 | Preview real testável sem contornar proteção SSO | Evidência de acesso autorizado e resultados E2E por SHA | PENDENTE |

## 9. Bloqueios e decisões necessárias

- O fluxo de login, callback, sessão e logout deve ser comprovado em Preview com acesso autorizado; HTTP 302 para o SSO da Vercel não é prova de falha do Auth0.
- As URLs efetivas de Preview precisam ser confirmadas antes de adicioná-las ao Auth0.
- O PR de integração Auth0 precisa passar por revisão de escopo/lockfile e manter-se Draft até os gates definidos.
- A política de criação da identidade local no primeiro login precisa ser aprovada antes de implementar persistência.
- Os contratos de tenant, membership, roles, permissions e auditoria continuam sujeitos à aprovação.
- Nenhuma migration executável, alteração de Production ou promoção é autorizada por este documento.

## 10. Checkpoint

Este documento descreve o contrato proposto para revisão. Não declara nenhum critério AUTH-LC como PASS e não afirma que o dashboard Auth0, Vercel, banco ou produção tenham sido alterados.
