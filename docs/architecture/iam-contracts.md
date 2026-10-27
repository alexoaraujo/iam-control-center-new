# Contratos IAM — versão inicial revisável

Status: **proposta para revisão; não aprovada para Production**.

## 1. Identidade externa
- A identidade é identificada exclusivamente pelo par OIDC validado `(issuer, subject)` (`iss`, `sub`).
- `issuer` deve ser uma URL HTTPS exata do emissor confiável; `subject` é opaco e sensível a maiúsculas/minúsculas.
- E-mail, nome e `email_verified` são atributos de perfil, nunca chaves de autorização.
- O servidor valida assinatura, `iss`, `aud`, `exp`, `iat`, `nonce` quando aplicável e estado da sessão antes de consultar o banco.

## 2. Tenant
- `iam.tenants.id` é o identificador interno imutável; `slug` é único e destinado a endereçamento, não é prova de autorização.
- Estado inicial permitido: `active`, `suspended`, `deleted`.
- Nenhum tenant é selecionado com base apenas em parâmetro controlado pelo navegador.

## 3. Membership
- Uma identidade pode ter no máximo uma membership por tenant.
- Estados: `invited`, `active`, `suspended`, `revoked`.
- Toda autorização exige membership `active` no tenant solicitado. A identidade global não implica membership em nenhum tenant.

## 4. Roles e permissões
- Roles pertencem a um tenant; `(id, tenant_id)` é chave candidata para impedir vínculos entre tenants.
- `membership_roles` relaciona memberships e roles somente quando ambos pertencem ao mesmo tenant.
- `role_permissions` liga role a permission key usando a mesma chave composta de tenant.
- Permissões são chaves globais e estáveis, por exemplo `iam.control_center.read`; nomes exibidos são metadados.
- A decisão de autorização é calculada no servidor por membership ativa + roles + permission; não confiar em claims de roles fornecidas pelo browser.

## 5. Contexto de tenant e RLS
- A aplicação deve iniciar uma transação, definir `app.tenant_id` a partir de contexto já autenticado/autorizado e limpar a transação ao terminar.
- Policies RLS são defesa em profundidade para consultas tenant-scoped.
- **Limite de confiança importante:** um GUC PostgreSQL comum (`app.tenant_id`) pode ser definido por qualquer sessão que tenha SQL. Portanto, RLS baseado apenas nesse GUC NÃO protege contra SQL injection/arbitrary SQL usando a mesma role. Antes de declarar isolamento forte, deve existir uma fronteira confiável (consultas parametrizadas e sem SQL arbitrário; ou contexto de sessão criptograficamente validado, com verificação no banco) e testes negativos usando a role efetiva de runtime.
- `FORCE ROW LEVEL SECURITY` deve ser habilitado nas tabelas tenant-scoped; runtime não pode ser owner, superuser nem possuir `BYPASSRLS`.

## 6. Auditoria
- Eventos de segurança registram ação, resultado, instante, tenant opcional, ator e request ID.
- Runtime pode inserir eventos; não deve atualizar ou excluir eventos existentes.
- Não gravar tokens, segredos, cookies ou payloads de autenticação integrais em metadata.

## 7. Papéis PostgreSQL
- `iam_owner`/owner equivalente: administração controlada, nunca usado pela aplicação.
- `iam_migrator`: execução de migrations em pipeline controlado; não é identidade de runtime.
- `iam_app_runtime`: privilégios mínimos de execução, sem `BYPASSRLS`, `CREATEDB`, `CREATEROLE` ou ownership. No schema inicial, pode ler tenants/roles/role assignments/permission catalog; pode gerenciar memberships e invitations conforme as policies; não pode criar tenants, alterar roles, atribuir roles ou alterar o catálogo de permissões diretamente. Essas operações exigem endpoints/rotinas confiáveis e restritas, ainda não implementadas.
- Roles de login específicas por ambiente podem herdar privilégios da role runtime, sem grants administrativos.
- Não reduzir ou alterar privilégios existentes automaticamente nesta migration; a reconciliação de roles é uma etapa separada e revisável.

## 8. Critérios de aprovação
1. Migration aplicada em branch limpa e repetível por versão/checksum.
2. Constraints e chaves compostas verificadas.
3. Testes positivos e negativos executados com role efetiva de runtime.
4. Prova de que uma membership/role de tenant A não autoriza acesso a tenant B.
5. Prova de que o runtime não consegue escrever em tenants/roles/role assignments/permission catalog nem alterar migrations; confirmar que não pode modificar/excluir auditoria.
6. CI PASS para o SHA da PR; Preview não substitui os testes SQL.
7. Production somente após revisão humana explícita, plano de recuperação e aprovação do deploy.
