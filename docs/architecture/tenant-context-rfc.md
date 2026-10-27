# RFC: contexto confiável de tenant para RLS

Status: **proposta técnica para revisão; não implementada nem aprovada**  
Escopo: resolver a limitação de segurança de `app.tenant_id` na migration 0001 sem alterar Development, Preview ou Production.

## Problema confirmado

A função atual `app_private.current_tenant_id()` lê `current_setting('app.tenant_id', true)`. Um papel SQL de runtime pode alterar um GUC customizado. Portanto, a policy que compara `tenant_id` com esse valor não é, isoladamente, uma fronteira de segurança contra SQL arbitrário executado com a mesma role.

## Alternativas avaliadas

1. **GUC com UUID simples — rejeitada para isolamento forte.** Fácil de usar, mas falsificável pela sessão.
2. **Role PostgreSQL por tenant — alternativa possível, porém com custo operacional e de pool de conexões; exigiria desenho próprio de provisionamento e rotação.**
3. **Contexto assinado, verificado dentro do banco — candidata recomendada para prototipagem isolada.** A aplicação autentica a identidade e autoriza a membership antes de emitir um contexto de curta duração, contendo no mínimo tenant ID, identidade/membership, instante de emissão/expiração e identificador de requisição. O banco valida a assinatura em toda leitura do contexto usada pelas policies; não basta validar uma vez e confiar num GUC com UUID.
4. **Broker de conexão/serviço confiável dedicado — alternativa a comparar**, se puder impedir que a sessão runtime execute SQL arbitrário diretamente ou separar de forma comprovável a autoridade de contexto.

## Desenho candidato (ainda não implementado)

- Usar envelope assinado com HMAC ou mecanismo criptográfico equivalente, incluindo os campos acima e versão do formato.
- Manter o segredo de verificação em objeto privado acessível apenas por função de verificação `SECURITY DEFINER`; nunca conceder SELECT ao runtime. O segredo da aplicação não deve ser derivado de dados controlados pelo cliente.
- Usar uma função de verificação com `search_path` fixo, nomes de objetos qualificados, validação estrita de formato, expiração e rotação de chave. Evitar privilégios desnecessários para o owner da função.
- Policies RLS devem consumir somente um contexto que tenha assinatura válida e não expirado. Alterar o GUC para um tenant diferente, UUID malformado, assinatura inválida ou contexto expirado deve resultar em zero linhas/rejeição, nunca em fallback permissivo.
- O contexto deve ser definido por transação e não persistir entre requisições em conexões reutilizadas. A limpeza do GUC ajuda a reduzir erros operacionais, mas **não substitui** a verificação criptográfica.
- A assinatura não substitui a autorização: o servidor só pode assinar tenant/membership depois de verificar identidade OIDC, membership ativa e a operação solicitada.
- Não incluir tokens OIDC, cookies, segredos ou material de assinatura em logs/auditoria.

## Testes obrigatórios antes de aprovar

- Contexto válido para tenant A permite apenas os dados autorizados de A.
- Tentar mudar o GUC para tenant B mantendo a assinatura de A não revela dados de B.
- UUID/contexto malformado, assinatura alterada, assinatura ausente e contexto expirado resultam em negação segura.
- Contexto não persiste entre transações/conexões reutilizadas.
- Role runtime não consegue ler segredo, alterar função verificadora, modificar tabela de chaves ou assumir role privilegiada.
- Testes de INSERT/UPDATE/DELETE verificam também `WITH CHECK`, grants efetivos e constraints compostas.
- Testar como o login de runtime efetivo, não como `Administrador`, owner ou papel com `BYPASSRLS`.
- Revisar rotação de chaves, concorrência, observabilidade sem vazamento de segredo e recuperação de incidentes.

## Critérios de decisão

A proposta só pode avançar para implementação após revisar a disponibilidade de extensão criptográfica suportada no Neon PostgreSQL, a separação de privilégios do verificador, o formato do envelope, a estratégia de rotação e a forma de executar testes como o runtime real. Não alterar a migration 0001 nem aplicar qualquer mudança nos ambientes compartilhados até essa revisão.

## Estado de evidência

- Confirmado: GUC simples é mutável por sessão; a migration atual é insuficiente para alegar isolamento forte contra SQL arbitrário.
- Confirmado: a conexão Neon desta integração está fixada em `Administrador` e não permite selecionar `iam_app_runtime_dev_safe` através do parâmetro de role; os testes de RLS com a role efetiva continuam bloqueados.
- Pendente: protótipo criptográfico, revisão independente, harness de testes de runtime e aprovação humana.
