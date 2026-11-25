# Console e estado operacional

Inventário em 25/11/2026, baseline de auditoria `12c24be31687ffe4cbece4a1719ac1d7f73f03aa`. Este documento descreve contratos e lacunas; não é aprovação operacional, de merge ou Production.

## Interface

- `/`: visão geral, navegação e seções históricas por âncora preservadas.
- `/organizations`, `/identities`, `/access`, `/policies`, `/audit`, `/security`, `/integrations`, `/environments`, `/evidence`, `/operations`: visualizações dedicadas, compartilhando a apresentação somente leitura e exigindo sessão Auth0 antes da consulta.
- `/protected`: rota de verificação de sessão Auth0, não prova de privilégio administrativo.
- Metadados públicos GitHub: consulta server-side, sem token; SHA da ponta observada de main e CI push correspondente, primeira página de PRs abertas (até 100). Ausência de execução correspondente não é sucesso. Consulta não prova release nem estado atual após o instante observado.
- Dados de tenants, identidades, memberships e auditoria: não consultados; nenhum zero fictício, nenhum CRUD, nenhum segredo enviado ao navegador. Auth0 autentica; PostgreSQL/RBAC/RLS autoriza.

## APIs existentes

| Endpoint | Contrato |
|---|---|
| GET /api/health | Liveness público; presença de configuração não comprova conectividade. |
| GET /api/ready | Sessão e probe de role/conexão; 401 anônimo, 503 não pronto. |
| POST /api/authorization/check | Sessão, seletores e permissão, prova HMAC privada e decisão no banco; 401/403/200. |
| POST /api/identity/sync | Integração de identidade separada; não habilitar escrita pela interface sem gate. |

## Evidências e pendências

- [G1 restauração isolada histórica](iam-g1-b2-real-restore-attestation-45060036018.md): escopo restrito, não prova rollback pós-COMMIT, encerramento de lease ou Production.
- [G2 custódia/observação](iam-g2-single-maintainer-observation-20261125.md): não confundir contrato offline com aquisição autorizada.
- [G3 executor pós-merge](iam-main-postmerge-g3-runbook.md): exigir grant 200, revoke 403, isolamento A/B e limpeza na fixture aprovada.
- [Gate Production](vercel-production-exact-sha-release-gate.md): HOLD até evidências e autorização específicas.
- [Política de atualização](../governance/pr-branch-update-policy.md): merge commit padrão, SHA e checks revalidados; preservar evidências históricas.

## Validação da interface

Executar lint, typecheck, testes, build, Preview no SHA exato e Auth0 E2E. Validar navegação e retorno pós-login de cada rota, layout mobile, teclado, ausência de vazamento de dados e estados de erro/fonte indisponível. Não aprovar com checks ausentes, ignorados ou antigos. Dependências, banco, workflows e credenciais não são modificados neste recorte.
