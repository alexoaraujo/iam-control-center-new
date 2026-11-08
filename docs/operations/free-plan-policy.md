# Política de uso exclusivamente Free

**Data de consulta:** 31/10/2026  
**Objetivo:** manter a arquitetura de referência operável sem contratar planos, add-ons, créditos pagos ou serviços que possam gerar cobrança.

> Os limites de planos são alteráveis pelos fornecedores. Esta página registra a documentação pública consultada nesta data; antes de cada novo projeto, conferir novamente as páginas oficiais e o painel da conta. Não tratar cotas como SLA ou capacidade garantida.

## Resumo executivo

| Plataforma | Plano adotado | Condição crítica |
|---|---|---|
| GitHub | Free | Controlar Actions, armazenamento e orçamento; limites variam conforme tipo de conta/owner |
| Auth0 | Free | 25.000 MAU; domínio personalizado exige verificação de cartão |
| Vercel | Hobby | Uso pessoal e não comercial; não é elegível para produto/serviço comercial |
| Neon | Free | Cotas por projeto e por conta; compute suspende após inatividade |

## GitHub Free

### Incluído e pontos de atenção

- Repositórios públicos e privados ilimitados.
- A página de preços do GitHub informa 2.000 minutos de CI/CD por mês no Free.
- A referência de faturamento consultada informa 500 MB de armazenamento de GitHub Actions e uma franquia de compute de US$ 12/mês para GitHub Free e Free for organizations. A referência de faturamento atual expressa essa franquia em valor monetário, não como minutos.
- O custo/uso adicional de produtos medidos pode ser cobrado se houver franquia excedida e orçamento sem a opção de interromper uso habilitada.

### Política operacional

1. Preferir Linux runners padrão e workflows curtos.
2. Evitar matriz de builds desnecessária e execução duplicada em push e pull request.
3. Definir budgets com **Stop usage when budget limit is reached** sempre que disponível.
4. Monitorar minutos/compute e armazenamento de Actions.
5. Não depender de funcionalidades de GitHub Team/Enterprise, como recursos avançados de governança que não estejam disponíveis na conta Free atual.
6. Antes de confiar em um número de minutos, verificar a tela de Billing do owner real do repositório; a página de preços e a referência de billing apresentam a franquia de formas diferentes.

Fontes oficiais:
- https://github.com/pricing
- https://docs.github.com/en/billing/reference/product-usage-included
- https://docs.github.com/en/actions/administering-github-actions/usage-limits-billing-and-administration

## Auth0 Free

### Incluído segundo a página oficial consultada

- US$ 0/mês.
- Até 25.000 usuários ativos mensais (MAU).
- Aplicativos de diferentes tipos.
- Conexões sociais ilimitadas.
- Até cinco Organizations.
- Proteção básica contra ataques.
- Suporte da comunidade.

### Restrições relevantes

- Domínio personalizado exige verificação de cartão de crédito. Para manter a regra de não cadastrar cartão, usar o domínio padrão `<tenant>.auth0.com`.
- A página de preços posiciona MFA com OTP/Duo, RBAC por Organization, logs de auditoria exportáveis e ambientes separados de desenvolvimento/produção nos planos pagos; não presumir esses recursos como parte do Free.
- Não presumir que todos os recursos de autorização, API, M2M, proteção avançada ou suporte estejam incluídos no Free.
- O limite MAU é uma cota de uso, não garantia de capacidade, SLA ou suporte empresarial.

### Política operacional

1. Usar tenant de desenvolvimento separado logicamente por configuração e callbacks exatos.
2. Não criar tenant/ambiente pago para obter separação de ambientes.
3. Manter Authorization Code Flow com PKCE e sessão server-side conforme SDK.
4. Implementar autorização de tenant, membership e permissões na aplicação; autenticação Auth0 não concede automaticamente privilégios.
5. Registrar callbacks, logout URLs e origins exatos; não liberar curingas.
6. Não cadastrar cartão para domínio personalizado nem ativar add-ons.

Fonte oficial:
- https://auth0.com/pt/pricing

## Vercel Hobby

### Elegibilidade obrigatória

O Hobby é gratuito, mas restrito a uso pessoal e não comercial. Se o IAM Control Center for utilizado como serviço comercial, produto SaaS, ferramenta interna de negócio ou atividade profissional/comercial, não presumir que Hobby seja elegível. Nesse caso, interromper a promoção para produção até revisar os termos e a elegibilidade.

### Cotas publicadas na documentação consultada

| Recurso | Hobby |
|---|---:|
| Fast Data Transfer | 100 GB |
| Fast Origin Transfer | 10 GB |
| CDN Requests | 1.000.000 |
| Active CPU | 4 CPU-horas |
| Provisioned Memory | 360 GB-horas |
| Function Invocations | 1.000.000 |
| Projetos | 200 |
| Deployments criados por dia | 100 |
| Tempo máximo de build por deployment | 45 minutos |
| Builds simultâneos | 1 |
| Logs de runtime | janela limitada; conferir limites atuais |

Ao exceder determinadas cotas, recursos podem ficar pausados até o período de retomada; o Hobby não deve ser tratado como plano com compra automática de overage. Consultar a página de limites para o comportamento específico de cada métrica.

### Política operacional

1. Usar apenas Preview e Production dentro dos limites e elegibilidade do Hobby.
2. Manter builds enxutos e apenas uma build simultânea.
3. Monitorar transferência, CPU, memória e invocações.
4. Não habilitar add-ons ou recursos pagos.
5. Não executar deploy de Production até concluir testes e autorização de release.
6. Confirmar se o uso real continua pessoal e não comercial.

Fontes oficiais:
- https://vercel.com/docs/plans/hobby
- https://vercel.com/docs/limits
- https://vercel.com/docs/plans

## Neon Free

### Cotas publicadas na documentação consultada

| Recurso | Free |
|---|---:|
| Projetos | 100 |
| Branches por projeto | 10 |
| Compute | 100 CU-horas por projeto/mês |
| Autoscaling | até 2 CU (aprox. 8 GB RAM) |
| PostgreSQL storage | 1 GB por projeto; 20 GB no total da conta |
| Transferência pública | 5 GB por projeto/mês |
| Scale to zero | após 5 minutos de inatividade |
| Histórico de Instant Restore | 6 horas, limitado a 1 GB de alterações |
| Manual snapshots | 1 |
| Monitoring history | 1 dia |

### Consequências operacionais

- Compute suspenso não consome CU-horas, mas o armazenamento continua contando para as cotas.
- Ao atingir o limite de branches, novas branches não poderão ser criadas até liberar espaço.
- Ao atingir o limite de armazenamento, operações que aumentariam o uso podem falhar; não presumir cobrança automática de overage no Free.
- Instant Restore e snapshots limitados não substituem backup lógico independente e teste de restauração.
- O limite de CU-horas é por projeto, não um pool único livremente compartilhado entre todos os projetos.

### Política operacional

1. Usar branches separadas para Development, Preview e testes, respeitando o máximo de 10.
2. Remover branches temporárias somente após confirmar que não são necessárias.
3. Monitorar compute, storage e transferência por projeto e no agregado da conta.
4. Usar conexão pooled para consultas serverless comuns; usar conexão direta quando a operação/migration exigir semântica de sessão.
5. Não aplicar migrations em branch Production durante validação.
6. Manter backups lógicos fora do Neon e testar restore.
7. Usar role de runtime sem superuser e sem `BYPASSRLS`; não usar a role administrativa como evidência de isolamento.

Fonte oficial:
- https://neon.com/docs/introduction/plans
- https://neon.com/docs/introduction/plans#free-plan
- https://neon.com/docs/manage/branches

## Controles transversais de custo

- Não cadastrar cartão em Auth0 ou Vercel para habilitar recursos opcionais.
- Não iniciar trials de planos pagos.
- Não contratar add-ons, serviços externos ou marketplaces pagos.
- Configurar budgets/stop-usage no GitHub quando disponível.
- Revisar cotas mensalmente nos quatro painéis.
- Guardar evidência datada da página de planos e do estado da conta.
- Não declarar “US$ 0 garantido” sem conferir billing, owner, elegibilidade, impostos e limites da conta.
- Se um requisito técnico depender de funcionalidade paga, documentar a limitação e bloquear a implantação em vez de ativar o recurso.

## Critério de aceite

O projeto só atende à política Free quando:
- cada serviço estiver no plano Free/Hobby correspondente;
- nenhum add-on, trial ou cobrança por uso estiver habilitado;
- a Vercel Hobby for elegível para o uso efetivo não comercial;
- as cotas atuais forem registradas por conta/projeto;
- o aplicativo continuar funcional dentro dessas cotas;
- a documentação separar limites do plano, configuração da conta e evidência de testes.
