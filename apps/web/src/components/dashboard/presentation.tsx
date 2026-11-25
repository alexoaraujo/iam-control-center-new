export const navigation = [
  { label: "Visão geral", href: "/", icon: "◫" },
  { label: "Organizações", href: "/organizations", icon: "▦" },
  { label: "Identidades", href: "/identities", icon: "◎" },
  { label: "Acesso e permissões", href: "/access", icon: "⌘" },
  { label: "Políticas", href: "/policies", icon: "◇" },
  { label: "Auditoria", href: "/audit", icon: "≋" },
  { label: "Segurança", href: "/security", icon: "⬡" },
  { label: "Integrações", href: "/integrations", icon: "⌁" },
  { label: "Ambientes", href: "/environments", icon: "▤" },
  { label: "Evidências", href: "/evidence", icon: "▣" },
  { label: "Operações", href: "/operations", icon: "◷" },
] as const;

export type DashboardPath = (typeof navigation)[number]["href"];

export function isDashboardPath(path: string): path is DashboardPath {
  return navigation.some(item => item.href === path);
}

export function Status({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warning" | "success" | "danger" }) {
  return <span className={`status status--${tone}`}><span className="status__dot" aria-hidden="true" />{children}</span>;
}

export function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="section-heading">
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
      <p>{description}</p>
    </div>
  );
}

