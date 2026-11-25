# PEOS P2 — leitura tenant-scoped (candidato)

Baseline 48fe2ad79d60197be6e5e644f581d3a0c53dd814. O console pode consultar um tenant explicitamente selecionado e até 50 identidades ativas por página, com cursor UUID. Nenhum diretório global, e-mail, issuer ou subject é retornado. A sessão Auth0 fornece o subject; os seletores do browser nunca concedem autorização. O SQL autoriza e projeta na mesma instrução após contexto HMAC em transação read-only. Exige login runtime NOBYPASSRLS, branch Neon esperada, tenant e membership ativos, grants específicos e ausência de ABAC ainda não avaliada.

O recurso permanece DESATIVADO: somente o Preview exclusivo iam-control-center-new-p2-directory-ci.vercel.app, branch feat/peos-p2-tenant-directory-20261125, com flag IAM_DIRECTORY_PREVIEW_ENABLED, branch Neon descartável IAM_DIRECTORY_PREVIEW_BRANCH_ID e lease IAM_DIRECTORY_PREVIEW_EXPIRES_AT de até 2h pode habilitá-lo. Não provisionar credenciais ou grants em Development/Production. Nenhuma aquisição privilegiada. A permissão iam.identity.read precisa de catálogo e grant revisados na fixture, sem inventar autorização operacional.

O PG18 CI executa a consulta estática real extraída do código, com fixtures sintéticas e rollback. E2E Auth0 verifica negação enquanto desativado. O teste positivo HTTP em Neon descartável, branch/lease autenticadas, grant→200, revoke→403, zero resíduos e revisão de dados minimizados é um gate separado antes de habilitar o recurso. Este documento não afirma execução nem aprovação de qualquer gate.

## Evidência da primeira execução

O contrato real da consulta PG18 no run 45642685862, job 139305273712, registrou PASS_P2_DIRECTORY_PG18_REAL_QUERY_GRANT_REVOKE_CROSS_TENANT_ROLLBACK e ausência de vazamento da fixture. Quality registrou 122 testes aprovados e zero falhas. O E2E da execução 45642685782 foi bloqueado por `Missing or wrong PR number on Preview origin 1`; não houve prova positiva de login nessa execução. Este registro posterior à abertura da PR dispara novo deployment Git nativo, preservando a exigência do PR ID. Toda validação deve ser repetida no novo SHA. A feature e Production permanecem em HOLD.

## Reconciliation and isolated fixture preparation

The run for 2a6537eda99c9345088d9b16873d383fad6ac46a proved exact PR 197 deployment binding and the PG18 query contract, but Auth0 rejected the callback (HTTP 403, callbackMismatch=true). No authenticated live P2 fixture was executed. The Preview callback, logout URL and web origin must be added without replacing other entries.

The runtime now additionally requires IAM_DIRECTORY_PREVIEW_APPROVED_SHA to match the complete VERCEL_GIT_COMMIT_SHA and IAM_DIRECTORY_PREVIEW_LEASE_START_AT to bound total lease duration to two hours; reserved existing Neon branches are rejected. No flag or credential is provisioned by this PR. Offline plan validator: scripts/p2-directory-fixture-plan.mjs (syntactic checks only; never treat as provider attestation).

Dedicated branch candidate: validation/peos-p2-pr197-directory, project tiny-rice-70320263, PG18 Free, database iam_database. Proposed parent br-muddy-bar-b63ksdy7 is the historical G3 synthetic parent; **must independently confirm clean/synthetic source and quota before creating**. Do not use any existing G1/G2/G3 lease or active database. No branch or endpoint is created by this change.

Operational sequence, only after reviewed exact-SHA CI and Auth0 callback:
1. Read provider project/branch/endpoint metadata; verify Free quota, source is synthetic, unique new branch, direct endpoint, expiry, exact SHA, and explicit maintainer approval. Validate sanitized plan offline, then authenticate provider evidence separately.
2. Prepare protected main-only trusted executor, dedicated operator credential, branch-only runtime credential and unique synthetic context signing key. No owner connection or key in the Preview. Verify TLS verify-full with system CA, database, branch, login and non-BYPASSRLS runtime; record baseline key and ledger counts. Do not enable the feature yet.
3. Provision branch-scoped configuration only for the exact reviewed deployment, including lease start/expiry and approved SHA; redeploy and verify actual origin before any write. Use reviewed test Auth0 subject digest, never log raw subject or credentials. Establish synthetic A/B fixture with reviewed catalog permissions; no real tenant data.
4. With the same authenticated session, prove before grant 403, grant 200 for organizations and identities (minimal projection), cross-tenant/wrong-identity 403, revoke 403. Verify the grant is visible from a separate committed transaction; test rollback and failure cleanup.
5. Revoke/clean in dependency order for exact fixture IDs, check zero residues including roles, memberships, grants, keys created by the run and unchanged ledger; verify feature disabled and lease ended, remove branch-only credentials and attest branch cleanup. If cleanup fails, block and use separately authorized emergency procedure. No automatic destructive action from this PR.
6. Keep Production HOLD; integrate only after reviewed gates. Never pass a synthetic plan as real HTTP evidence.

The earlier PG18 evidence remains historical. This document is a plan, not an approved operational lease.
