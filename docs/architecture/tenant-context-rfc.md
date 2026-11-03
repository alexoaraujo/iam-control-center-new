# RFC: contexto confiável de tenant para RLS

Status: **proposta técnica para revisão; não implementada nem aprovada**  
Escopo: definir como policies RLS poderão identificar tenant/identity/membership sem confiar em dados manipuláveis pela sessão SQL. Não altera Development, Preview ou Production.

## Problema confirmado

A função baseada em `current_setting('app.tenant_id', true)` aceita um custom GUC que a própria sessão SQL pode modificar. Uma role runtime capaz de executar SQL arbitrário pode trocar o UUID. Portanto, esse valor isolado não é uma fronteira de segurança contra SQL arbitrário executado sob a mesma role.

## Alternativas em avaliação

1. **GUC com UUID simples — rejeitada como controle de isolamento forte.** Pode ser útil para roteamento/defesa em profundidade, nunca como única prova de tenant.
2. **Role PostgreSQL por tenant — não selecionada.** Exige desenho de provisionamento, conexão/pool, rotação e limites operacionais.
3. **Contexto assinado verificado no banco — candidata para protótipo isolado.** A aplicação só emite contexto depois de autenticar a identidade OIDC e autorizar membership ativa. O banco precisa verificar assinatura, expiração e formato em cada uso do contexto pelas policies.
4. **Broker/serviço de conexão confiável — alternativa a comparar.** Deve demonstrar que a sessão SQL da aplicação não consegue forjar ou substituir o contexto.
5. **JWT assimétrico verificável no banco — alternativa a estudar.** Não presumir que `pgcrypto` forneça validação JWT pronta; algoritmo, parser, canonicalização e rotação precisam de prova técnica.

## HMAC: candidato, não decisão

HMAC não está aprovado. Antes de adotá-lo, exigir:

- threat model documentando o que ocorre se a aplicação ou a sessão SQL for comprometida;
- algoritmo e canonicalização inequívocos do envelope;
- segredo fora de tabelas legíveis pelo runtime, com acesso exclusivo à função verificadora;
- função `SECURITY DEFINER` com `search_path` fixo, objetos qualificados e privilégios mínimos;
- expiração curta, versão de chave, rotação, revogação e comportamento em indisponibilidade;
- proteção contra replay conforme modelo de transação/requisição;
- prova de que o runtime não consegue ler/alterar segredo, função, tabela de chaves ou assumir role privilegiada;
- avaliação da extensão criptográfica no PostgreSQL/Neon e aprovação explícita antes de instalá-la.

A assinatura não substitui autorização. Se o backend que possui a chave de assinatura estiver totalmente comprometido, ele poderá emitir contexto falso; esse risco precisa estar explícito no modelo.

## Baseline fail-closed deste PR

A migration proposta habilita e força RLS em todas as tabelas IAM/audit, sem criar policies e sem conceder privilégios de runtime. Assim, mesmo após grants de teste, o runtime não vê linhas e não consegue inserir/alterar dados enquanto não houver policy. Isso é deliberado e impede que a entrega sugira isolamento forte inexistente.

## Testes obrigatórios antes de aprovar policies

- Contexto válido de tenant A só permite operações autorizadas em A.
- Alterar o GUC para tenant B mantendo prova/contexto de A não revela B.
- Contexto ausente, malformado, assinatura inválida ou expirado resulta em negação segura.
- Contexto não vaza entre transações/conexões reutilizadas.
- Runtime não lê segredos, não altera verificador/chaves e não assume roles privilegiadas.
- INSERT/UPDATE/DELETE exercitam `WITH CHECK`, grants efetivos e FKs compostas.
- Execução com login/role runtime efetivo, não owner, superuser ou papel `BYPASSRLS`.
- Rotação, concorrência, replay, observabilidade sem vazamento e recuperação de incidente.

## Estado de evidência

- Confirmado no desenho atual: GUC simples é mutável pela sessão.
- Confirmado no estado de integração registrado: conexão Neon está fixada em `Administrador`; teste como login runtime efetivo continua bloqueado.
- Pendente: seleção do mecanismo, protótipo criptográfico/broker, revisão independente e testes runtime reais.
- Não autorizado: instalação de extensão, alteração de roles ou execução de migration em qualquer branch Neon.
