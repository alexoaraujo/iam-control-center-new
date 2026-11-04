# ADR-0001: seleção do mecanismo de contexto confiável de tenant

- **Status:** proposta para revisão; decisão **ADIADA**.
- **Data:** 2026-11-04
- **Escopo:** IAM Control Center, PostgreSQL/Neon e aplicação Next.js com Auth0.
- **Relacionado:** `docs/architecture/tenant-context-rfc.md`, `docs/architecture/iam-decisions.md`, `docs/security/iam-tenant-context-readiness-review.md`.
- **Não autoriza:** migration, extensão, alteração de role/grant/policy, secrets, Neon, Auth0, Vercel ou Production.

## Contexto

O POC HMAC demonstra um caminho criptográfico possível em PostgreSQL 18 descartável, mas não demonstra integração de identidade, autorização de membership, operação Neon, pooling, rotação, revogação ou replay. A sessão SQL runtime não pode ser considerada confiável apenas porque a aplicação autenticou o usuário: SQL arbitrário executado com a mesma credencial pode tentar alterar GUCs e chamar funções disponíveis.

A fronteira precisa impedir que o cliente web ou a sessão SQL runtime inventem tenant/identity/membership. O contexto deve ser emitido por componente confiável somente após validar identidade OIDC, tenant ativo, membership ativa e autorização da operação.

## Requisitos eliminatórios

Qualquer alternativa deve demonstrar todos os itens abaixo antes de ser selecionada:

1. Fail-closed para contexto ausente, malformado, inválido, expirado ou revogado.
2. Tenant e identidade derivados de autorização server-side, não de parâmetros não confiáveis do browser/SQL.
3. A sessão runtime não consegue forjar, alterar, emitir ou elevar contexto.
4. Segredos/chaves de emissão não são legíveis pelo runtime SQL.
5. Verificação de integridade executável no PostgreSQL/Neon com primitives suportadas e testadas.
6. Vínculo inequívoco entre tenant, identity/membership, audience/scope e expiração.
7. Plano testado para rotação, revogação, replay, rollback, concorrência e conexão reutilizada.
8. Nenhum privilégio de owner, migrator, superuser ou BYPASSRLS no runtime.
9. Custos, latência e comportamento em indisponibilidade documentados.
10. Evidência em PostgreSQL descartável e depois em Neon Development isolado, com login runtime efetivo.

## Alternativas

| Alternativa | Vantagens | Riscos/limitações | Avaliação atual |
|---|---|---|---|
| GUC com UUID simples | Muito simples; fácil de propagar por transação | O runtime pode definir o mesmo GUC; não é prova de tenant | **Rejeitada** como fronteira de segurança |
| HMAC com chave no banco | Verificação local; primitives pgcrypto; POC já existente | O componente emissor precisa de acesso ao segredo; se web/runtime e emissor forem o mesmo domínio comprometível, invasor pode emitir contexto; constant-time, rotação/revogação e replay ainda não provados | **Candidata condicionada** a broker isolado |
| Assinatura assimétrica (ex.: Ed25519/ES256) | Chave privada pode ficar fora do banco; banco verifica com chave pública; separa emissor/verificador | Suporte de verificação no PostgreSQL/Neon e biblioteca segura precisam ser provados; parser/canonicalização/JWT não devem ser improvisados em SQL | **Candidata condicionada** a spike de compatibilidade |
| Role PostgreSQL por tenant | Identidade de tenant fica na autorização do banco, não em GUC | Explosão operacional de roles, grants, provisioning, limites de conexão/pooling e manutenção; troca de role segura precisa ser demonstrada | **Não selecionada**; manter como comparador |
| Broker de contexto/conexão confiável | Isola emissão/credenciais do processo web; pode mediar autorização e DB | Novo serviço crítico, autenticação serviço-a-serviço, disponibilidade, latência e operação; não resolve sozinho a verificação RLS | **Candidata arquitetural** combinável com HMAC ou assinatura assimétrica |

## Decisão proposta

**Adiar a seleção criptográfica.** A decisão depende de dois spikes pequenos e comparáveis:

- **Spike A — HMAC + broker isolado:** o broker recebe uma identidade autenticada por canal confiável, consulta/valida membership e permissão, emite contexto de curta duração; chave HMAC não é disponibilizada ao web runtime nem à sessão SQL runtime. O PostgreSQL verifica com função de privilégios mínimos. Demonstrar rotação, revogação e comparação constant-time ou justificar formalmente o risco residual.
- **Spike B — assinatura assimétrica + broker isolado:** mesmo contrato de autorização, mas o broker assina com chave privada externa e o banco verifica com chave pública usando implementação suportada e revisada. Demonstrar algoritmo, parser, canonicalização, rotação e suporte efetivo no Neon.

O broker não pode aceitar `tenant_id`, `subject`, `membership_id` ou permissões do browser como autoridade. Deve derivá-los de identidade OIDC validada e consultar o estado atual de autorização. A aplicação web não deve possuir credencial de assinatura.

## Critérios comparativos dos spikes

Cada spike deve entregar:
- threat model e diagrama de trust boundaries;
- implementação isolada sem migrations de produto;
- payload versionado com `iss`, `aud`, tenant, identity/membership, scope/ação, `iat`, `exp`, `kid` e request/operation ID;
- testes de adulteração, assinatura errada, expiração, chave desconhecida, rotação, revogação, replay e contexto de outro tenant;
- testes runtime com SQL arbitrário limitado à role runtime, incluindo tentativa de mudar GUC, chamar emissor/verificador, ler chave, alterar função e assumir roles;
- transações commit/rollback, savepoints, reuso de conexão, concorrência e endpoint pooler efetivamente habilitado;
- medições de latência e comportamento fail-closed durante indisponibilidade do broker/keys;
- evidência de compatibilidade Neon em branch Development isolada, sem Production.

A comparação final deve avaliar segurança sob comprometimento do browser, SQL runtime, processo web e broker separadamente. Não declarar proteção contra comprometimento do broker se o broker for o emissor autorizado.

## Plano de execução

1. Revisar e aprovar threat model e requisitos eliminatórios.
2. Implementar Spike A e Spike B em harnesses isolados e equivalentes.
3. Executar a mesma suíte de ataque e pooling nos dois.
4. Revisão independente dos resultados e seleção por ADR aprovada.
5. Só então desenhar policies/grants e integração Auth0 → membership → broker → contexto → Neon.
6. Autorizar Development separadamente; Preview depois; Production somente com aprovação explícita e plano de recuperação.

## Consequências e limites

- Nenhum mecanismo está aprovado para produção por este ADR.
- O POC HMAC permanece evidência experimental, não código de produção.
- O baseline fail-closed sem policies/grants runtime continua correto enquanto a decisão estiver pendente.
- Não reutilizar o GUC simples como controle de isolamento.
- Não executar SQL do harness em Neon nem instalar pgcrypto/extensão como consequência deste documento.

**Resultado:** ADR proposta, decisão adiada até comparação baseada em evidência.