import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IAM Control Center | Identity & Access Governance",
  description: "Console administrativo para governança de identidade, acesso, segurança e auditoria multi-tenant.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
