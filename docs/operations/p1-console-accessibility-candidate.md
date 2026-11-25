# PEOS P1 — acessibilidade e navegação responsiva

Candidato PR #196. O console passa a apresentar um landmark main único, link para saltar a navegação, níveis de heading consistentes e menu com rótulos visíveis no viewport compacto. Tipografia, foco e áreas de interação foram ajustados sem alterar autorização ou dados.

Aceite: Quality, PG18, Preview e Auth0 E2E no mesmo SHA, 11 rotas, reflow a 320px sem scroll horizontal, alvo de navegação de pelo menos 44px e foco no conteúdo após ativar o skip link. WCAG completa não é comprovada por estes testes: revisar contraste de todos os estados, zoom, leitor de tela e dispositivos reais antes de declarar conformidade.

A primeira execução (45642259534) foi bloqueada por ausência/divergência do PR ID na prova de origem Vercel (deploy inicial anterior ao vínculo da PR). O contrato de origem não foi alterado. Este commit documental posterior à abertura da PR permite novo deployment Git nativo, sem injetar metadados nem desabilitar checks. Production HOLD.
