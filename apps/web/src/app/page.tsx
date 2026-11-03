import { redirect } from "next/navigation";
import { auth0 } from "../lib/auth0";

const navigation = [
  { label: "Visão geral", href: "#overview", icon: "◫" },
  { label: "Organizações", href: "#organizations", icon: "▦" },
  { label: "Identidades", href: "#identities", icon: "◎" },
  { label: "Acesso e permissões", href: "#access", icon: "⌘" },
  { label: "Políticas", href: "#policies", icon: "◇" },
  { label: "Auditoria", href: "#audit", icon: "≋" },
  { label: "Segurança", href: "#security", icon: "⬡" },
  { label: "Integrações", href: "#integrations", icon: "⌁" },
  { label: "Ambientes", href: "#environments", icon: "▤" },
  { label: "Evidências", href: "#evidence", icon: "▣" },
];

function Status({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warning" | "success" | "danger" }) {
  return <span className={`status status--${tone}`}><span className="status__dot" />{children}</span>;
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="section-heading">
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
      <p>{description}</p>
    </div>
  );
}

export default async function HomePage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login?returnTo=/");

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="IAM Control Center - início">
          <span className="brand-mark">I<span>A</span></span>
          <span className="brand-copy"><strong>IAM CONTROL</strong><small>CENTER</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switcher"><span className="workspace-avatar">IC</span><span><strong>IAM Platform</strong><small>Console de governança</small></span><span className="chevron">⌄</span></div>
        <nav className="main-nav" aria-label="Navegação principal">
          <span className="nav-caption">GERENCIAMENTO</span>
          {navigation.slice(0, 5).map((item, index) => (
            <a className={index === 0 ? "nav-link nav-link--active" : "nav-link"} href={item.href} key={item.href}>
              <span className="nav-icon">{item.icon}</span>{item.label}
            </a>
          ))}
          <span className="nav-caption nav-caption--spaced">GOVERNANÇA</span>
          {navigation.slice(5).map((item) => (
            <a className="nav-link" href={item.href} key={item.href}><span className="nav-icon">{item.icon}</span>{item.label}</a>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="support-card"><span className="support-icon">?</span><strong>Central de segurança</strong><p>Princípios, controles e procedimentos operacionais.</p><a href="#security">Consultar controles <span>↗</span></a></div>
          <div className="sidebar-user"><span className="user-avatar">IA</span><span><strong>Usuário autenticado</strong><small>Sessão Auth0</small></span><a href="/auth/logout" aria-label="Encerrar sessão">↗</a></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>Visão geral</strong></div>
          <div className="topbar-actions"><span className="environment-pill"><i /> AMBIENTE NÃO IDENTIFICADO</span><a className="icon-button" href="#evidence" aria-label="Central de evidências">◷</a><a className="topbar-avatar" href="/auth/logout" aria-label="Sair">IA</a></div>
        </header>

        <div className="content" id="overview">
          <div className="welcome-row">
            <div><span className="eyebrow">IDENTITY · ACCESS · GOVERNANCE</span><h1>Centro de controle</h1><p>Visão operacional de identidade, acesso e segurança da plataforma.</p></div>
            <div className="welcome-actions"><span className="read-only-label"><span /> VISÃO SOMENTE LEITURA</span><a className="button button--secondary" href="#evidence">Ver evidências <span>↗</span></a></div>
          </div>

          <div className="notice notice--info"><span className="notice-icon">i</span><div><strong>Painel em fase de estruturação</strong><p>Os módulos e indicadores abaixo definem a estrutura de governança. Métricas operacionais só serão exibidas após integração e validação das fontes reais. Nenhum dado demonstrativo é apresentado como produção.</p></div><Status tone="warning">DADOS NÃO CONECTADOS</Status></div>

          <div className="notice notice--warning"><span className="notice-icon">!</span><div><strong>Autenticação não equivale a autorização administrativa</strong><p>A sessão Auth0 protege a entrada. A validação de papel administrativo, membership e permissão ainda precisa ser implementada antes de habilitar operações ou expor dados de tenants.</p></div><Status tone="warning">RBAC PENDENTE</Status></div>\n\n          <div className="metric-grid">
            {[
              ["Identidades", "—", "Diretório de usuários", "Aguardando fonte"],
              ["Organizações", "—", "Tenants cadastrados", "Aguardando fonte"],
              ["Memberships ativos", "—", "Vínculos autorizados", "Aguardando fonte"],
              ["Eventos de auditoria", "—", "Janela de 24 horas", "Aguardando fonte"],
            ].map(([label, value, hint, state]) => <article className="metric-card" key={label}><div className="metric-top"><span>{label}</span><span className="metric-symbol">↗</span></div><strong className="metric-value">{value}</strong><div className="metric-foot"><span>{hint}</span><span>{state}</span></div></article>)}
          </div>

          <div className="overview-grid">
            <section className="panel-card posture-card">
              <div className="panel-title"><div><span className="eyebrow">SECURITY POSTURE</span><h3>Postura de segurança</h3></div><Status tone="warning">NÃO AVALIADA</Status></div>
              <div className="posture-empty"><div className="shield-ring">⬡</div><strong>Coleta de evidências pendente</strong><p>O índice de segurança será calculado somente quando os controles tiverem fontes verificáveis, critérios e resultados vinculados a um SHA ou ambiente.</p><a href="#evidence">Entender critérios <span>→</span></a></div>
              <div className="posture-legend"><span><i className="legend-dot legend-dot--green" /> Verificado</span><span><i className="legend-dot legend-dot--amber" /> Pendente</span><span><i className="legend-dot legend-dot--gray" /> Não verificado</span></div>
            </section>
            <section className="panel-card integrations-card">
              <div className="panel-title"><div><span className="eyebrow">PLATFORM HEALTH</span><h3>Saúde das integrações</h3></div><a href="#integrations" className="text-link">Detalhes ↗</a></div>
              <div className="integration-row"><span className="integration-logo integration-logo--auth">A</span><div><strong>Auth0</strong><small>Identidade e sessão OIDC</small></div><Status tone="warning">A VALIDAR</Status></div>
              <div className="integration-row"><span className="integration-logo integration-logo--neon">N</span><div><strong>Neon PostgreSQL</strong><small>Persistência e isolamento RLS</small></div><Status tone="warning">A VALIDAR</Status></div>
              <div className="integration-row"><span className="integration-logo integration-logo--github">GH</span><div><strong>GitHub Actions</strong><small>CI, checks e evidências por SHA</small></div><Status tone="neutral">NÃO CONSULTADO</Status></div>
              <div className="integration-row"><span className="integration-logo integration-logo--vercel">V</span><div><strong>Vercel</strong><small>Preview e proteção de deployment</small></div><Status tone="neutral">NÃO CONSULTADO</Status></div>
            </section>
          </div>

          <section className="panel-card controls-card">
            <div className="panel-title"><div><span className="eyebrow">CONTROL PLANE</span><h3>Domínios de governança</h3><p>Áreas funcionais previstas para operação do IAM.</p></div><span className="subtle-count">10 MÓDULOS</span></div>
            <div className="module-grid">
              {[
                ["01","Organizações","Ciclo de vida de tenants, status e configurações.","#organizations","▦"],
                ["02","Identidades","Identidade externa por issuer + subject.","#identities","◎"],
                ["03","Acesso e permissões","Memberships, papéis e autorização efetiva.","#access","⌘"],
                ["04","Políticas","Regras de acesso e decisão deny-by-default.","#policies","◇"],
                ["05","Auditoria","Eventos append-only e trilha de investigação.","#audit","≋"],
                ["06","Segurança","Controles, riscos, exceções e postura.","#security","⬡"],
                ["07","Integrações","Auth0, Neon, GitHub e Vercel.","#integrations","⌁"],
                ["08","Ambientes","Development, Preview e Production.","#environments","▤"],
                ["09","Evidências","SHA, workflow, execução e artefatos.","#evidence","▣"],
                ["10","Operações","Saúde, incidentes e procedimentos.","#operations","◷"],
              ].map(([number,title,description,href,icon]) => <a className="module-card" href={href} key={number}><span className="module-icon">{icon}</span><span className="module-number">{number}</span><strong>{title}</strong><p>{description}</p><span className="module-arrow">↗</span></a>)}
            </div>
          </section>

          <section className="panel-card" id="organizations">
            <SectionHeading eyebrow="TENANT MANAGEMENT" title="Organizações" description="Administração de tenants e fronteiras de dados. A listagem será habilitada após a persistência IAM e as políticas RLS serem aprovadas." />
            <div className="empty-state"><span className="empty-icon">▦</span><strong>Nenhuma fonte de organizações conectada</strong><p>Não há consulta operacional habilitada para listar tenants neste estágio.</p><Status tone="warning">NOT CONFIGURED / NOT VERIFIED</Status></div>
          </section>

          <section className="panel-card" id="identities">
            <SectionHeading eyebrow="IDENTITY DIRECTORY" title="Diretório de identidades" description="Identidades federadas e vínculo com o provedor OIDC." />
            <div className="info-strip"><strong>Chave de identidade</strong><code>(issuer, subject)</code><p>E-mail é atributo mutável de perfil e não deve ser usado como identificador primário.</p></div>
            <div className="empty-state empty-state--compact"><strong>Diretório ainda não disponível</strong><p>A integração de leitura depende do modelo IAM persistido e da validação de sessão Auth0 no servidor.</p><Status tone="warning">AGUARDANDO IMPLEMENTAÇÃO</Status></div>
          </section>

          <section className="panel-card" id="access">
            <SectionHeading eyebrow="AUTHORIZATION" title="Acesso e permissões" description="Memberships, papéis, escopos e decisões de autorização no servidor." />
            <div className="three-column">
              <div className="mini-control"><span>01 / PRINCIPAL</span><strong>Identidade autenticada</strong><p>Issuer e subject validados pelo servidor.</p></div>
              <div className="mini-control"><span>02 / TENANT</span><strong>Membership ativo</strong><p>Vínculo ativo com a organização solicitada.</p></div>
              <div className="mini-control"><span>03 / POLICY</span><strong>Permissão explícita</strong><p>Escopo e recurso autorizados; negar por padrão.</p></div>
            </div>
            <div className="section-status"><Status tone="warning">AUTORIZAÇÃO OPERACIONAL NÃO COMPROVADA</Status><span>Sem administração de papéis até a conclusão dos controles de banco.</span></div>
          </section>

          <section className="panel-card" id="policies">
            <SectionHeading eyebrow="POLICY ENGINE" title="Políticas de acesso" description="Regras versionadas, avaliáveis e auditáveis para decisões de acesso." />
            <div className="policy-row"><div><strong>Negação por padrão</strong><p>Ausência de contexto, membership ou permissão resulta em negação.</p></div><Status tone="warning">A VALIDAR</Status></div>
            <div className="policy-row"><div><strong>Isolamento cross-tenant</strong><p>Uma identidade de tenant A não pode ler ou alterar dados do tenant B.</p></div><Status tone="warning">A VALIDAR</Status></div>
            <div className="policy-row"><div><strong>Revogação de membership</strong><p>Membership revogado deve perder acesso sem depender da interface.</p></div><Status tone="warning">A VALIDAR</Status></div>
          </section>

          <section className="panel-card" id="audit">
            <SectionHeading eyebrow="AUDIT LEDGER" title="Trilha de auditoria" description="Registro estruturado de eventos de segurança e operações administrativas." />
            <div className="empty-state empty-state--compact"><span className="empty-icon">≋</span><strong>Nenhum evento consultado</strong><p>O painel não gera eventos fictícios. A fonte auditável será habilitada após persistência, retenção e controle de integridade.</p><Status tone="warning">FONTE NÃO CONECTADA</Status></div>
          </section>

          <section className="panel-card" id="security">
            <SectionHeading eyebrow="SECURITY OPERATIONS" title="Segurança e riscos" description="Acompanhamento de controles técnicos e riscos de configuração." />
            <div className="risk-list">
              <div><span className="risk-code">IAM-01</span><div><strong>Contexto de tenant confiável</strong><p>GUC isolado não constitui prova de autorização.</p></div><Status tone="warning">EM PROTOTIPAGEM</Status></div>
              <div><span className="risk-code">DB-02</span><div><strong>Role de runtime e RLS</strong><p>Validar grants efetivos e ausência de BYPASSRLS.</p></div><Status tone="warning">NÃO VERIFICADO</Status></div>
              <div><span className="risk-code">CI-03</span><div><strong>Integridade das evidências</strong><p>Vincular resultados ao SHA exato do commit candidato.</p></div><Status tone="success">CRITÉRIO DEFINIDO</Status></div>
              <div><span className="risk-code">DEP-04</span><div><strong>Proteção de Preview</strong><p>Trusted Sources só é PASS quando a proteção estiver ativa e testada.</p></div><Status tone="warning">PENDENTE</Status></div>
            </div>
          </section>

          <section className="panel-card" id="integrations">
            <SectionHeading eyebrow="SERVICE CONNECTIONS" title="Integrações" description="Conectividade, autenticação e evidência operacional dos serviços externos." />
            <div className="integration-detail-grid">
              <div><strong>Auth0</strong><span>Provedor de identidade OIDC</span><small>Verificar issuer, audience, callback, sessão e logout.</small><Status tone="warning">EVIDÊNCIA POR AMBIENTE PENDENTE</Status></div>
              <div><strong>Neon</strong><span>PostgreSQL gerenciado</span><small>Cliente server-only existente; factory não comprova conexão nem query.</small><Status tone="warning">RUNTIME NÃO VALIDADO</Status></div>
              <div><strong>GitHub</strong><span>Repositório e CI/CD</span><small>Checks devem ser associados ao SHA exato.</small><Status tone="neutral">CONSULTA NÃO AUTOMATIZADA</Status></div>
              <div><strong>Vercel</strong><span>Hospedagem e Preview</span><small>Deployment e proteção devem ser verificados separadamente.</small><Status tone="warning">PROTEÇÃO PENDENTE</Status></div>
            </div>
          </section>

          <section className="panel-card" id="environments">
            <SectionHeading eyebrow="DEPLOYMENT GOVERNANCE" title="Ambientes" description="Segregação de credenciais, bancos e permissões de deployment." />
            <div className="environment-grid">
              <div><span className="env-dot env-dot--dev" /><strong>Development</strong><p>Branch Neon isolada e credenciais de desenvolvimento.</p><Status tone="neutral">NÃO CONSULTADO</Status></div>
              <div><span className="env-dot env-dot--preview" /><strong>Preview</strong><p>Ambiente efêmero por PR, sem acesso a Production.</p><Status tone="warning">PROTEÇÃO A VALIDAR</Status></div>
              <div><span className="env-dot env-dot--prod" /><strong>Production</strong><p>Promoção controlada, aprovação e rollback.</p><Status tone="warning">SEM AUTORIZAÇÃO DE DEPLOY</Status></div>
            </div>
          </section>

          <section className="panel-card" id="evidence">
            <SectionHeading eyebrow="EVIDENCE LEDGER" title="Central de evidências" description="Cada controle precisa de prova verificável, contexto e rastreabilidade." />
            <div className="evidence-schema">
              {["Controle","Ambiente","Repositório / PR","SHA exato","Workflow / Run ID","Procedimento e resultado","Artefato sanitizado","Limitações e conclusão"].map((item,index) => <div key={item}><span>{String(index+1).padStart(2,"0")}</span><strong>{item}</strong></div>)}
            </div>
            <div className="notice notice--warning"><span className="notice-icon">!</span><div><strong>Política de evidências</strong><p>PASS somente quando a evidência cobre o critério no SHA e ambiente avaliados. Execução ausente, ignorada, antiga ou de outro commit não é PASS.</p></div></div>
          </section>

          <section className="panel-card" id="operations">
            <SectionHeading eyebrow="OPERATIONS" title="Operações e continuidade" description="Health checks, resposta a incidentes, backup, restore e rollback." />
            <div className="operation-grid"><div><strong>Health / readiness</strong><p>Separar configuração presente de conectividade efetiva.</p><Status tone="warning">HEALTH LIMITADO AO SCAFFOLD</Status></div><div><strong>Backup e restore</strong><p>Exercício isolado documentado antes de operações críticas.</p><Status tone="warning">NÃO ENSAIADO</Status></div><div><strong>Rollback</strong><p>Procedimento testável para aplicação e schema.</p><Status tone="warning">PENDENTE</Status></div></div>
          </section>

          <footer className="page-footer"><span>IAM CONTROL CENTER <i>•</i> GOVERNANÇA DE IDENTIDADE E ACESSO</span><span>Console em evolução · Dados operacionais não conectados</span></footer>
        </div>
      </section>
    </main>
  );
}
