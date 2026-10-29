"use client";

import { useMemo, useState } from "react";
import styles from "./dashboard.module.css";

type RuntimeCheck = {
  ok: boolean;
  service?: string;
  status?: string;
  authConfigured?: boolean;
  databaseConfigured?: boolean;
  checkedAt?: string;
  error?: string;
};

type DashboardProps = {
  userLabel: string;
  authenticated: boolean;
  authConfigured: boolean;
  databaseConfigured: boolean;
};

const milestones = [
  { id: "ci", title: "Qualidade de código", area: "Engenharia", status: "historical", detail: "CI passou no SHA anterior; revalidar no commit deste dashboard.", evidence: "https://github.com/alexoaraujo83/iam-control-center/actions/runs/40788097458" },
  { id: "oidc", title: "Início do fluxo OIDC", area: "Autenticação", status: "partial", detail: "Endpoint /auth/login redirecionou para Auth0 com PKCE S256 no checkpoint anterior.", evidence: "https://github.com/alexoaraujo83/iam-control-center/pull/34" },
  { id: "e2e", title: "Login, callback, sessão e logout", area: "Autenticação", status: "pending", detail: "Exige teste ponta a ponta autorizado no Preview.", evidence: "https://iam-control-center-preview.vercel.app/auth/login" },
  { id: "contracts", title: "Aprovar contratos IAM-DC-01…08", area: "Arquitetura", status: "pending", detail: "A proposta de domínio existe; as decisões ainda precisam de aprovação explícita.", evidence: "https://github.com/alexoaraujo83/iam-control-center/pull/35" },
  { id: "migration", title: "Migration revisável + testes", area: "Dados", status: "blocked", detail: "Bloqueada até a aprovação dos contratos. Não executar migration.", evidence: "https://github.com/alexoaraujo83/iam-control-center" },
  { id: "rls", title: "Privilégios runtime, isolamento e RLS", area: "Segurança", status: "pending", detail: "Requer testes no banco não produtivo com papel runtime de privilégio mínimo.", evidence: "https://github.com/alexoaraujo83/iam-control-center" },
] as const;

const statusLabel: Record<string, string> = {
  historical: "PASS histórico",
  partial: "Parcial",
  pending: "Pendente",
  blocked: "Bloqueado",
};

export default function Dashboard({ userLabel, authenticated, authConfigured, databaseConfigured }: DashboardProps) {
  const [health, setHealth] = useState<RuntimeCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const visibleMilestones = useMemo(() => milestones.filter((item) => {
    const matchesFilter = filter === "all" || item.status === filter;
    const needle = query.trim().toLocaleLowerCase("pt-BR");
    const matchesQuery = !needle || `${item.title} ${item.area} ${item.detail}`.toLocaleLowerCase("pt-BR").includes(needle);
    return matchesFilter && matchesQuery;
  }), [filter, query]);

  async function runHealthCheck() {
    setChecking(true);
    setNotice("");
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      const payload = await response.json() as RuntimeCheck;
      setHealth({ ...payload, ok: response.ok && payload.ok, checkedAt: new Date().toISOString() });
      setUpdatedAt(new Date().toISOString());
      setNotice(response.ok ? "Diagnóstico de runtime concluído. Isso não substitui a suíte CI nem o E2E Auth0." : "O endpoint de diagnóstico retornou falha.");
    } catch {
      setHealth({ ok: false, error: "Não foi possível consultar /api/health.", checkedAt: new Date().toISOString() });
      setNotice("Falha ao consultar o endpoint de saúde.");
    } finally {
      setChecking(false);
    }
  }

  function exportEvidence() {
    const bundle = {
      generatedAt: new Date().toISOString(),
      repository: "alexoaraujo83/iam-control-center",
      dashboard: "interactive-control-dashboard",
      runtimeCheck: health,
      authSession: authenticated ? "authenticated" : "not_authenticated_in_this_request",
      runtimeConfiguration: { authConfigured, databaseConfigured },
      milestones: milestones.map((item) => ({ ...item, evidenceStatus: item.status === "historical" ? "historical_not_current_sha" : item.status })),
      limitations: [
        "Exportação gerada pelo navegador; não é atestado assinado nem evidência CI.",
        "PASS histórico não equivale a PASS no SHA atual.",
        "Variáveis presentes não comprovam conexão, login E2E, autorização tenant-scoped ou RLS.",
        "Nenhuma migration ou promoção para Production é executada pelo dashboard.",
      ],
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `iam-control-center-evidence-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("Pacote JSON exportado. Trate-o como relatório auxiliar, não como evidência CI assinada.");
  }

  const completed = milestones.filter((item) => item.status === "historical").length;
  const openGates = milestones.filter((item) => item.status === "pending" || item.status === "blocked").length;

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <a className={styles.brand} href="#inicio"><span className={styles.brandMark}>IC</span><span><strong>IAM Control Center</strong><small>Identity · Access · Governance</small></span></a>
        <div className={styles.navLabel}>WORKSPACE</div>
        <nav className={styles.nav}>
          <a className={styles.navActive} href="#inicio"><span>▦</span> Visão geral</a>
          <a href="#testes"><span>✓</span> Testes e diagnósticos</a>
          <a href="#evidencias"><span>◈</span> Evidências</a>
          <a href="#progresso"><span>◷</span> Progresso do projeto</a>
          <a href="#bloqueios"><span>⚑</span> Bloqueios e gates</a>
        </nav>
        <div className={styles.sidebarBottom}>
          <div className={styles.secureIcon}>⌁</div>
          <strong>Security-first</strong>
          <p>Decisões e entregas devem ser rastreáveis por SHA e evidência.</p>
          <span className={styles.environment}>AMBIENTE · PREVIEW</span>
        </div>
      </aside>

      <main className={styles.main} id="inicio">
        <header className={styles.topbar}>
          <div><span className={styles.breadcrumb}>Workspace / </span><strong>Visão geral</strong></div>
          <div className={styles.userArea}>
            <span className={authenticated ? styles.onlineDot : styles.idleDot} />
            <span>{userLabel}</span>
            {authenticated ? <a className={styles.textLink} href="/auth/logout">Sair</a> : <a className={styles.textLink} href="/auth/login">Entrar</a>}
          </div>
        </header>

        <section className={styles.welcome}>
          <div>
            <div className={styles.eyebrow}>PAINEL DE CONTROLE · IAM</div>
            <h1>Visão geral do projeto</h1>
            <p>Acompanhe validações, evidências, resultados e gates de segurança em um único lugar.</p>
          </div>
          <button className={styles.secondaryButton} onClick={runHealthCheck} disabled={checking}>{checking ? "Verificando…" : "↻ Atualizar diagnóstico"}</button>
        </section>

        <section className={styles.metrics} aria-label="Resumo do projeto">
          <article className={styles.metricCard}><div className={styles.metricTop}><span>Qualidade CI</span><span className={styles.metricIcon}>✓</span></div><strong className={styles.metricValue}>PASS*</strong><div className={styles.metricFoot}>Último registro conhecido · SHA anterior</div></article>
          <article className={styles.metricCard}><div className={styles.metricTop}><span>Gates em aberto</span><span className={styles.metricIcon}>⚑</span></div><strong className={styles.metricValue}>{openGates}</strong><div className={styles.metricFoot}>Pendentes ou bloqueados</div></article>
          <article className={styles.metricCard}><div className={styles.metricTop}><span>Configuração runtime</span><span className={styles.metricIcon}>⌘</span></div><strong className={styles.metricValue}>{authConfigured && databaseConfigured ? "Parcial" : "Atenção"}</strong><div className={styles.metricFoot}>Presença de variáveis, não conectividade</div></article>
          <article className={styles.metricCard}><div className={styles.metricTop}><span>Etapas documentais</span><span className={styles.metricIcon}>◈</span></div><strong className={styles.metricValue}>{completed}/{milestones.length}</strong><div className={styles.metricFoot}>Somente etapa com PASS histórico</div></article>
        </section>

        <section className={styles.grid} id="testes">
          <article className={styles.panel}>
            <div className={styles.panelHeading}><div><h2>Testes e diagnósticos</h2><p>Execute verificações disponíveis e abra os pipelines oficiais.</p></div><span className={styles.pillBlue}>AÇÕES</span></div>
            <div className={styles.actionList}>
              <div className={styles.actionRow}><span className={styles.actionIcon}>⌁</span><div className={styles.actionText}><strong>Saúde do runtime</strong><small>Consulta real ao endpoint /api/health, sem expor segredos.</small></div><button onClick={runHealthCheck} disabled={checking} className={styles.smallButton}>{checking ? "Executando…" : "Executar"}</button></div>
              <div className={styles.actionRow}><span className={styles.actionIcon}>✓</span><div className={styles.actionText}><strong>Suíte de qualidade CI</strong><small>Install frozen, audit, lint, typecheck, testes e build. No GitHub, selecione “Run workflow”.</small></div><a className={styles.smallButton} href="https://github.com/alexoaraujo83/iam-control-center/actions/workflows/quality.yml" target="_blank" rel="noreferrer">Executar CI ↗</a></div>
              <div className={styles.actionRow}><span className={styles.actionIcon}>◎</span><div className={styles.actionText}><strong>Fluxo de autenticação Auth0</strong><small>Inicia o login OIDC; não valida sozinho callback/sessão/logout.</small></div><a className={styles.smallButton} href="/auth/login">Iniciar login ↗</a></div>
              <div className={styles.actionRow}><span className={styles.actionIcon}>⇩</span><div className={styles.actionText}><strong>Exportar pacote de evidências</strong><small>JSON com diagnóstico, gates e limitações conhecidas.</small></div><button className={styles.smallButton} onClick={exportEvidence}>Exportar JSON</button></div>
            </div>
            {notice && <p className={styles.notice} role="status">{notice}</p>}
            {health && <div className={styles.resultBox} role="status"><div className={styles.resultHeader}><strong>Resultado do diagnóstico</strong><span className={health.ok ? styles.statusGood : styles.statusBad}>{health.ok ? "RESPOSTA RECEBIDA" : "FALHA"}</span></div><pre>{JSON.stringify(health, null, 2)}</pre></div>}
          </article>

          <article className={styles.panel} id="evidencias">
            <div className={styles.panelHeading}><div><h2>Última evidência registrada</h2><p>Referência histórica; não atesta o SHA desta branch.</p></div><span className={styles.pillAmber}>HISTÓRICO</span></div>
            <div className={styles.evidenceHeadline}><span className={styles.evidenceCheck}>✓</span><div><strong>Quality + Preview deployment</strong><small>Workflow #40788097458 · PR #34</small></div></div>
            <div className={styles.evidenceMeta}><span>Conclusão registrada</span><strong>success</strong></div>
            <div className={styles.evidenceMeta}><span>SHA avaliado</span><code>921cecac8425</code></div>
            <div className={styles.evidenceMeta}><span>Validade para este SHA</span><strong className={styles.textAmber}>Revalidar</strong></div>
            <a className={styles.inlineLink} href="https://github.com/alexoaraujo83/iam-control-center/actions/runs/40788097458" target="_blank" rel="noreferrer">Consultar run no GitHub ↗</a>
            <div className={styles.warning}><strong>Regra de evidência</strong><p>PASS só é válido para o SHA exato verificado. Run antigo, check ausente ou deployment de outro commit não é PASS atual.</p></div>
          </article>
        </section>

        <section className={styles.panel} id="progresso">
          <div className={styles.panelHeading}><div><h2>Progresso e gates do projeto</h2><p>Filtre os itens, pesquise por área e abra a evidência de cada etapa.</p></div><span className={styles.countPill}>{visibleMilestones.length} itens</span></div>
          <div className={styles.filters}>
            <input aria-label="Pesquisar etapas" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar etapa, área ou detalhe…" />
            <select aria-label="Filtrar status" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Todos os status</option><option value="historical">PASS histórico</option><option value="partial">Parcial</option><option value="pending">Pendente</option><option value="blocked">Bloqueado</option></select>
          </div>
          <div className={styles.milestoneList}>
            {visibleMilestones.map((item) => <article className={styles.milestone} key={item.id}>
              <span className={item.status === "historical" ? styles.timelineGood : item.status === "partial" ? styles.timelinePartial : item.status === "blocked" ? styles.timelineBlocked : styles.timelinePending}>{item.status === "historical" ? "✓" : item.status === "partial" ? "◐" : item.status === "blocked" ? "!" : "·"}</span>
              <div className={styles.milestoneBody}><div className={styles.milestoneTitle}><strong>{item.title}</strong><span className={styles.areaLabel}>{item.area}</span></div><p>{item.detail}</p><a href={item.evidence} target="_blank" rel="noreferrer">Abrir referência/evidência ↗</a></div>
              <span className={item.status === "historical" ? styles.statusGood : item.status === "partial" ? styles.statusPartial : item.status === "blocked" ? styles.statusBad : styles.statusPending}>{statusLabel[item.status]}</span>
            </article>)}
            {visibleMilestones.length === 0 && <p className={styles.empty}>Nenhuma etapa corresponde ao filtro informado.</p>}
          </div>
        </section>

        <section className={styles.bottomGrid} id="bloqueios">
          <article className={styles.panel}><div className={styles.panelHeading}><div><h2>Bloqueios prioritários</h2><p>Itens que impedem declarar prontidão para produção.</p></div></div><ul className={styles.blockerList}><li><span>01</span><div><strong>Auth0 E2E autorizado</strong><p>Concluir login, callback, sessão e logout no Preview.</p></div><b>PENDENTE</b></li><li><span>02</span><div><strong>Aprovação dos contratos IAM</strong><p>Resolver decisões IAM-DC-01 a IAM-DC-08 antes de SQL.</p></div><b>BLOQUEIA MIGRATION</b></li><li><span>03</span><div><strong>Banco não produtivo e RLS</strong><p>Confirmar branch Neon e role runtime sem BYPASSRLS.</p></div><b>PENDENTE</b></li></ul></article>
          <article className={styles.panel}><div className={styles.panelHeading}><div><h2>Resposta do sistema</h2><p>Último retorno do diagnóstico executado nesta tela.</p></div></div>{health ? <><div className={styles.responseStatus}><span className={health.ok ? styles.statusGood : styles.statusBad}>{health.ok ? "OK" : "FALHA"}</span><span>{health.checkedAt ? new Date(health.checkedAt).toLocaleString("pt-BR") : "Sem horário"}</span></div><p className={styles.responseSummary}>{health.ok ? "O endpoint respondeu. Consulte o JSON acima para os indicadores reportados." : health.error ?? "O endpoint reportou uma falha."}</p></> : <div className={styles.emptyState}><span>⌁</span><strong>Nenhum diagnóstico executado nesta sessão</strong><p>Use “Executar” para obter uma resposta real do endpoint.</p></div>}{updatedAt && <small className={styles.updatedAt}>Atualizado em {new Date(updatedAt).toLocaleTimeString("pt-BR")}</small>}</article>
        </section>

        <footer className={styles.footer}><span>IAM Control Center · Painel operacional</span><span>Sem execução de migrations · Sem promoção para Production</span></footer>
      </main>
    </div>
  );
}
