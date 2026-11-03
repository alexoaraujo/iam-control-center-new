# Decisão criptográfica — pendente

**Estado:** NOT DECIDED

O protótipo usa um registro opaco local para exercitar fluxo de contexto. Ele não valida assinatura, HMAC, emissor OIDC, `iss`/`sub`, `kid`, `jti`, nonce ou anti-replay.

Antes de qualquer desenho de produção, decidir:
- HMAC compartilhado vs assinatura assimétrica vs broker confiável;
- localização, rotação e revogação de chaves;
- como a role runtime fica impedida de ler material secreto;
- como o PostgreSQL valida assinatura sem confiar em GUC fornecida pelo cliente;
- validade curta, `jti` e política explícita de replay;
- funções `SECURITY DEFINER`, owner `NOLOGIN`, `search_path`, grants e auditoria.

Não inferir segurança criptográfica a partir dos testes desta fixture.
