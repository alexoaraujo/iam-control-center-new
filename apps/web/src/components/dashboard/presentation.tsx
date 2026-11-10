export const navigation = [
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

export function Status({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warning" | "success" | "danger" }) {
  return <span className={`status status--${tone}`}><span className="status__dot" />{children}</span>;
}

export function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="section-heading">
      <div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2></div>
      <p>{description}</p>
    </div>
  );
}

