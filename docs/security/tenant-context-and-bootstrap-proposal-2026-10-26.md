# Proposta de fronteira de confiança para tenant context e bootstrap OIDC

- Data: 2026-10-26
- Estado: **proposta técnica para revisão; não aprovada**
- PR de referência: https://github.com/alexoaraujo83/iam-control-center/pull/30
- Branch: proposal/initial-iam-schema
- Escopo: arquitetura e critérios de aceitação; nenhum banco Neon compartilhado é alterado
- Dependências: ADR-0002 (RBAC aceito), ADR-0003 (tenant discovery/catálogos globais ainda em proposta), SQL candidato 0001

## 1. Decisão pendente

O SQL candidato usa \`app.tenant_id\` diretamente como contexto de RLS. O CI demonstrou que uma sessão capaz de executar SQL arbitrário pode alterar esse valor e consultar outro tenant. O conteúdo de um GUC simples não comprova identidade nem autorização: PostgreSQL disponibiliza mecanismos para consultar e alterar parâmetros de sessão/transação.

Fontes oficiais:
- https://www.postgresql.org/docs/18/ddl-rowsecurity.html
- https://www.postgresql.org/docs/18/config-setting.html
- https://www.postgresql.org/docs/18/functions-admin.html

## 2. Opções avaliadas

| Opção | Mecanismo | Proteção | Custo / risco | Avaliação |
|---|---|---|---|---|
| A — GUC simples | Backend valida OIDC/membership e define \`app.tenant_id\` dentro da transação | Defesa contra consultas que esquecem o filtro de tenant e erros não maliciosos no código | SQL arbitrário usando a mesma credencial pode trocar o GUC; não contém SQL injection | Não serve como barreira contra execução arbitrária de SQL |
| B — Capability assinada | Backend emite contexto curto e assinado; função privada PostgreSQL valida assinatura antes de retornar tenant para RLS | O caller não consegue alterar tenant, membership ou expiração sem a chave de assinatura | Exige gestão/rotação de chave, função verificadora privilegiada e fluxo de bootstrap revisado | **Recomendação para o perfil security-first**, sujeita a protótipo e review |
| C — Credencial/role por tenant | Conexão ou identidade SQL separada por tenant | A separação pode ser imposta pela identidade SQL em vez de um valor de sessão | Pool, rotação e operação crescem com tenants; verificar limites do provedor | Alternativa se B não passar na revisão |

A opção B não é automaticamente segura: a função deve ter privilégios mínimos, owner não-login conforme desenho aprovado, \`search_path\` vazio/fixo, nomes schema-qualified, grants explícitos e testes negativos. A chave privada nunca fica no repositório, bundle do browser nem acessível pela role runtime.

## 3. Recomendação: capability de curta duração

### Conteúdo lógico

Após validar a sessão OIDC e resolver uma membership ativa, o backend emite uma capability contendo:
- versão do formato e identificador da chave;
- identidade local derivada dos claims OIDC validados;
- tenant selecionado e membership ativa;
- expiração UTC/epoch;
- HMAC-SHA-256 sobre a representação canônica de todos os campos.

Validade máxima proposta: **120 segundos**. O backend valida membership e status do tenant antes de emitir e revalida no início de cada requisição autenticada. A capability limita o contexto de tenant; não substitui autorização por permissão no backend.

### Verificação PostgreSQL

1. A chave de assinatura fica em segredo server-side da aplicação e é provisionada numa tabela privada do banco por um processo separado usando a credencial de migrator.
2. A role runtime não recebe SELECT nessa tabela, não é sua proprietária e não possui DDL.
3. A função verificadora fica em schema privado, usa os privilégios estritamente necessários, tem \`search_path\` vazio/fixo e referências totalmente qualificadas.
4. Token ausente, malformado, expirado, com chave desconhecida/inativa ou assinatura inválida gera contexto nulo e negação por RLS.
5. A policy obtém tenant somente da função que verifica a capability; o GUC simples \`app.tenant_id\` deixa de ser fonte de autorização.
6. A função não retorna a chave nem o segredo; apenas o escopo validado necessário à policy.
7. A rotação usa key id, uma janela curta de sobreposição e remoção da chave antiga após TTL mais margem operacional.

A capability assinada protege contra alteração arbitrária do tenant em SQL sem a chave. Ela não protege contra comprometimento total do backend ou vazamento da chave; esses são limites explicitamente separados.

## 4. Bootstrap OIDC e descoberta de tenants

O fluxo inicial precisa operar antes que haja um tenant selecionado. Sequência proposta:

1. O Auth0 SDK valida a sessão OIDC no servidor, incluindo issuer, subject, audience/claims necessários e expiração conforme contrato da aplicação.
2. O backend emite uma capability de identidade curta, separada da capability tenant-scoped.
3. Uma interface de dados restrita resolve ou cria a identidade local usando o par exato \`(issuer, subject)\`; e-mail é atributo mutável, não chave de autorização.
4. A descoberta retorna apenas tenants com membership \`active\` e tenant \`active\`. A função não aceita um \`identity_id\` arbitrário como autoridade.
5. A seleção enviada pelo cliente é apenas um seletor; o backend valida outra vez a membership para o tenant escolhido.
6. O backend emite a capability tenant-scoped. Consultas RBAC e de dados são executadas numa transação com contexto local.
7. Membership \`invited\` é tratada em fluxo separado. Membership \`suspended\`/\`revoked\` e tenant \`suspended\`/\`deleted\` não concedem acesso normal.

### Interface de dados proposta

- Não conceder SELECT irrestrito ao runtime em \`iam.tenants\`, \`iam.identities\` nem em todo o catálogo de memberships como mecanismo de descoberta.
- Não expor função que aceite qualquer identity id e devolva tenants.
- A resolução de identidade e a descoberta devem validar uma capability de identidade emitida pelo backend confiável, ou usar uma alternativa com nível de segurança equivalente revisada formalmente.
- \`iam.permissions\` é um catálogo global de definições. A leitura deve limitar-se a metadados necessários; ler uma chave não concede a permissão correspondente.
- As funções privilegiadas exigem revisão de owner, \`search_path\`, privilégios EXECUTE, mensagens de erro, concorrência e testes negativos.

Esta seção é contrato proposto: não afirma que as funções de bootstrap já existam ou que o login Auth0 esteja implementado.

## 5. Regras de implementação e privilégios

1. A role runtime continua não proprietária, sem \`BYPASSRLS\`, \`SUPERUSER\`, \`CREATEDB\`, \`CREATEROLE\` ou DDL.
2. Credenciais de migrator são separadas do runtime e não são usadas em requisições normais.
3. Funções \`SECURITY DEFINER\` ficam em schema privado, com \`search_path\` vazio/fixo, referências qualificadas e EXECUTE grants mínimos.
4. A função que verifica capability é pequena e não retorna o segredo.
5. Segredos e tokens não entram em logs, artefatos ou relatórios. Evidências registram key id, versão do algoritmo, checksum do SQL, SHA de código e resultado.
6. Testes usam um LOGIN runtime não proprietário, não apenas \`SET ROLE\` de uma sessão administrativa.
7. A API usa queries parametrizadas; o frontend não recebe acesso SQL nem decide permissões com base em claims enviados pelo cliente.
8. RLS é defesa adicional; não substitui autorização server-side.

## 6. Testes obrigatórios em PostgreSQL descartável

| Cenário | Resultado esperado |
|---|---|
| Capability válida para tenant A | Consulta tenant-scoped retorna somente A |
| Alterar GUC simples para B mantendo capability A | Continua limitado a A; o GUC simples é ignorado |
| Alterar tenant, identity, membership, expiração, key id ou assinatura | Contexto nulo e acesso negado |
| Token expirado / chave inativa / assinatura inválida | Negado; sem revelar segredo em erros |
| Capability de identidade válida sem membership | Descoberta vazia |
| Identidade com memberships ativas em A e B | Descoberta retorna apenas A e B |
| Identidade A tenta usar capability B não assinada para ela | Negado |
| Membership suspensa/revogada ou tenant suspenso/deletado | Backend não emite capability; acesso normal negado |
| Reuso de conexão entre A e B | Nenhum contexto residual entre transações |
| Descoberta com identity id arbitrário | Interface rejeita chamada sem capability válida |
| Runtime consulta tabela de chaves ou ledger | Negado |
| Runtime executa DDL ou assume role privilegiada | Negado |
| Rotação de chave | Chave nova aceita; chave expirada/revogada rejeitada |
| Falha no meio da transação | Rollback sem mutações incompletas |
| Inserção concorrente da mesma identidade externa | Um único registro por \`(issuer, subject)\` |
| Token de A usado para pedir dados de B | Negado |

O teste anterior de spoofing deve tornar-se regressão: espera-se que alterar o GUC simples não mude o tenant quando a capability estiver ativa. A falha do protótipo simples permanece como evidência histórica; não se deve promover esse helper sem revisão.

## 7. Critérios para sair de BLOCKED

- [ ] Aprovar explicitamente a opção B ou documentar uma aceitação de risco fundamentada da opção A.
- [ ] Aprovar contratos de bootstrap, identidade e descoberta da ADR-0003.
- [x] Prototipar verificação HMAC, rejeição de campos alterados, expiração e tentativa de spoof do GUC simples em PostgreSQL descartável; provisionamento/rotação ainda pendentes.
- [ ] Revisar funções privilegiadas, ownership, grants e search_path.
- [ ] Provar idempotência, concorrência, rollback, recuperação, checksum e testes cross-tenant por SHA.
- [ ] Validar uma credencial runtime real num branch Neon isolado.
- [ ] Comparar schema da branch isolada com o alvo \`iam_control_center\`.
- [ ] Preparar migration versionada revisada; arquivos em \`database/proposals/\` não são executados pelo runner de produção.
- [ ] Solicitar aprovação explícita antes de aplicar em Development; Production exige aprovação separada.

## 8. Estado atual

- RBAC tenant-scoped: aceito em ADR-0002.
- Bootstrap OIDC, descoberta e acesso aos catálogos globais: pendentes de aprovação final.
- Capability assinada: protótipo SQL/teste implementado nesta branch; aprovação de arquitetura e implementação real no backend continuam pendentes.
- SQL candidato 0001: permanece apenas proposta; foi atualizado para um protótipo de capability tenant assinada, coberto por testes PostgreSQL descartáveis. O emissor da aplicação, o bootstrap de chave e o bootstrap de identidade pré-tenant continuam pendentes.
- Nenhuma migration foi executada em Neon. Nenhuma role, grant, chave, variável, segredo ou deployment compartilhado foi alterado.
- Classificação de segurança: **BLOCKED para promoção até revisão e validação da fronteira de confiança**.
