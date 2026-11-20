# PEOS — Registro de execução de atualização e integração de PRs (20/11/2026)

**Repositório:** `alexoaraujo/iam-control-center-new`  
**Escopo:** leitura autenticada de GitHub/Vercel, reconciliação Git de branches e verificação dos checks.  
**Classificação:** evidência técnica, **não** aprovação de merge, E2E/Auth0, operação Neon, B2, rollback ou release.

## Configuração efetiva de atualização

- O GitHub respondeu `allow_update_branch=true` e `allow_merge_commit=true` em consulta autenticada de 20/11/2026. Em leitura anterior, `allow_update_branch=false`; a operação administrativa que alterou o campo **não** foi efetuada por esta execução.
- A ativação apenas sugere atualização de branches defasadas. O método **merge commit** como padrão e o **rebase somente como exceção sem vínculos SHA/auditoria** estão propostos na [PR #143](https://github.com/alexoaraujo/iam-control-center-new/pull/143), ainda sem merge.
- A API de GitHub conectada não expõe mutação administrativa do repositório; o estado foi **confirmado por readback**, não atribuído falsamente a esta automação.

## Updates de branch realizados (merge commits com dois pais; sem rebase/force)

| PR | Base atualizada | HEAD anterior | Novo HEAD | Behind após update | Arquivos de mudança preservados | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| [#126](https://github.com/alexoaraujo/iam-control-center-new/pull/126) | #44 / `28b8ef345f0db051f25bb9b1e463094323193cd9` | `0be23964388bc679eb8b7f3a4ed15946db59` | [`ad2933d46d019b3df5cfe02da427f755e3630abe`](https://github.com/alexoaraujo/iam-control-center-new/commit/ad2933d46d019b3df5cfe02da427f755e3630abe) | 0 | 3 | Draft |
| [#131](https://github.com/alexoaraujo/iam-control-center-new/pull/131) | #126 / `ad2933d46d019b3df5cfe02da427f755e3630abe` | `2ab48724ec9506f0b1b787a9564fa97921711351` | [`5dd24c8337437e714bf0f6ee863366d80246a1ee`](https://github.com/alexoaraujo/iam-control-center-new/commit/5dd24c8337437e714bf0f6ee863366d80246a1ee) | 0 | 2 | Draft |
| [#121](https://github.com/alexoaraujo/iam-control-center-new/pull/121) | #119 / `a3b0464854cacf0dccb988e9b1fd73c6e023f443` | `55dac1c52e3b9d453d2a8db4c5c2efb2ca1ff4c7` | [`f727ecefad5498c91237928e89bcba093dafd87f`](https://github.com/alexoaraujo/iam-control-center-new/commit/f727ecefad5498c91237928e89bcba093dafd87f) | 0 | 13 | Draft |
| [#125](https://github.com/alexoaraujo/iam-control-center-new/pull/125) | #121 / `f727ecefad5498c91237928e89bcba093dafd87f` | `4e7e3e65db7f8648f92ab3f0413395f289a185ab` | [`59fc114e12c27871b546f797557114437cde02ee`](https://github.com/alexoaraujo/iam-control-center-new/commit/59fc114e12c27871b546f797557114437cde02ee) | 0 | 5 arquivos próprios; 1 arquivo de qualidade já satisfaz o objetivo na base | Draft |

**Técnica aplicada:** obter HEAD e base em tempo real; determinar merge-base; comparar lista de arquivos e alterações; para arquivos sem sobreposição, unir os blobs da PR na árvore da base; para `quality.yml` da #121, reconciliar as mudanças de três vias sem sobreposição de linhas; para #125, manter a configuração Preview mais estrita da base quando ambas haviam removido a mesma permissão. Verificar árvore resultante contra árvore da base, criar commit com **HEAD antigo como primeiro pai** e base atual como segundo; atualizar ref em **fast-forward com expected SHA e force=false**. Readback confirmou ambas as referências ancestrais, diferenças de arquivos e `behind=0`.

## Resultado dos novos checks, não confundir PG18 com Auth0 E2E

| PR | Quality | Preview | PostgreSQL 18 / contratos especializados | Sync Auth0 Preview | Auth0 E2E | Security-gate integrado | CI |
| --- | --- | --- | --- | --- | --- | --- | --- |
| #126 | SUCCESS | SUCCESS | SUCCESS | FAILURE | SKIPPED | FAILURE | FAILURE |
| #131 | SUCCESS | SUCCESS | SUCCESS | FAILURE | SKIPPED | FAILURE | FAILURE |
| #121 | SUCCESS | SUCCESS | SUCCESS | FAILURE | SKIPPED | FAILURE | FAILURE |
| #125 | SUCCESS | SUCCESS | SUCCESS | FAILURE | SKIPPED | FAILURE | FAILURE |

**Execuções GitHub:** [#126 CI 44677148092](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44677148092), [#131 CI 44677253518](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44677253518), [#121 CI 44677527636](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44677527636), [#125 CI 44677688259](https://github.com/alexoaraujo/iam-control-center-new/actions/runs/44677688259). Os resultados acima são das conclusões efetivas dos jobs; a tentativa de obter texto dos logs retornou `BlobNotFound` e não autoriza inventar motivo de falha individual.

## Bloqueio operacional de callback compartilhado

Leitura autenticada Vercel do projeto `prj_OnuwD1iarOsXh6FFGkSpK4A5mj80` / time `aoa4`:

- `iam-control-center-new-ci-preview.vercel.app`: domínio verificado, `gitBranch=integration/peos-g1-g2-canonical-bun-20261118`.
- `iam-control-center-new-preview.vercel.app`: **mesma branch**.
- Ambos os aliases apontam para deployment `dpl_78MUXdvRvLZ32RWYctXi9R5HncXP` (`READY`), commit `3da16f0c18f3ab4067f47ee7e6ca666862c45778` (PR #132, já fechada).

A configuração de callback **não** corresponde às branches #126, #131, #121, #125 ou #143. Não assumir que esse diagnóstico prova causa individual de cada job: os textos detalhados dos logs recém-executados não estavam disponíveis. **Proibido mover aliases compartilhados ou afirmar Auth0 E2E SUCCESS sem lease, allowlist Auth0, variáveis específicas, exclusividade, rollback e revalidação do HEAD.**

## Próximas dependências e bloqueios

1. [#143](https://github.com/alexoaraujo/iam-control-center-new/pull/143): política de merge commit em revisão solicitada; `security-gate=FAILURE` no SHA `9daa2472c6214cbb0e6a7b602c38419b3a9288e5`, `auth0-e2e=SKIPPED`. Não mesclar.
2. [#128](https://github.com/alexoaraujo/iam-control-center-new/pull/128): base #125 agora `59fc114e...`; três arquivos com mudança simultânea, incluindo políticas de `IAM-G1` Environment e testes. Diferença **semântica** sobre zero required reviewers versus modo de reviewer opcional; requer correção analisada, não escolha automática. [#130](https://github.com/alexoaraujo/iam-control-center-new/pull/130) aguarda #128.
3. [#44](https://github.com/alexoaraujo/iam-control-center-new/pull/44) → #126 → #131 e [#119](https://github.com/alexoaraujo/iam-control-center-new/pull/119) → #121 → #125 estão atualizadas até onde indicado; nenhum merge final das PRs realizado.
4. Outras seis PRs com `mergeable=false` no snapshot anterior: #45, #47, #70, #76, #77, #86; precisam de conflitos revisados e testes de PostgreSQL 18/ACL/rollback/Preview.
5. [#123](https://github.com/alexoaraujo/iam-control-center-new/pull/123): Ready for Review e revisão solicitada ao colaborador com escrita `alexoaraujo83`. Uma revisão pendente **não** conta como aprovação.

**Cuidado:** os SHA e statuses deste checkpoint são históricos e não dispensam nova leitura imediatamente antes da próxima operação.  
**PEOS:** Executar → Verificar → Corrigir → Testar → Revisar → Validar → Avançar.
