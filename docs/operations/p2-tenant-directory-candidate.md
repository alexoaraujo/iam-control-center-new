# PEOS P2 — leitura tenant-scoped (candidato)

Baseline 48fe2ad79d60197be6e5e644f581d3a0c53dd814. O console pode consultar um tenant explicitamente selecionado e até 50 identidades ativas por página, com cursor UUID. Nenhum diretório global, e-mail, issuer ou subject é retornado. A sessão Auth0 fornece o subject; os seletores do browser nunca concedem autorização. O SQL autoriza e projeta na mesma instrução após contexto HMAC em transação read-only. Exige login runtime NOBYPASSRLS, branch Neon esperada, tenant e membership ativos, grants específicos e ausência de ABAC ainda não avaliada.

O recurso permanece DESATIVADO: somente o Preview exclusivo iam-control-center-new-p2-directory-ci.vercel.app, branch feat/peos-p2-tenant-directory-20261125, com flag IAM_DIRECTORY_PREVIEW_ENABLED, branch Neon descartável IAM_DIRECTORY_PREVIEW_BRANCH_ID e lease IAM_DIRECTORY_PREVIEW_EXPIRES_AT de até 2h pode habilitá-lo. Não provisionar credenciais ou grants em Development/Production. Nenhuma aquisição privilegiada. A permissão iam.identity.read precisa de catálogo e grant revisados na fixture, sem inventar autorização operacional.

O PG18 CI executa a consulta estática real extraída do código, com fixtures sintéticas e rollback. E2E Auth0 verifica negação enquanto desativado. O teste positivo HTTP em Neon descartável, branch/lease autenticadas, grant→200, revoke→403, zero resíduos e revisão de dados minimizados é um gate separado antes de habilitar o recurso. Este documento não afirma execução nem aprovação de qualquer gate.

## Evidência da primeira execução

O contrato real da consulta PG18 no run 45642685862, job 139305273712, registrou PASS_P2_DIRECTORY_PG18_REAL_QUERY_GRANT_REVOKE_CROSS_TENANT_ROLLBACK e ausência de vazamento da fixture. Quality registrou 122 testes aprovados e zero falhas. O E2E da execução 45642685782 foi bloqueado por `Missing or wrong PR number on Preview origin 1`; não houve prova positiva de login nessa execução. Este registro posterior à abertura da PR dispara novo deployment Git nativo, preservando a exigência do PR ID. Toda validação deve ser repetida no novo SHA. A feature e Production permanecem em HOLD.
