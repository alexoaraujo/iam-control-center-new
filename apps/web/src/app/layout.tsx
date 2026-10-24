import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "IAM Control Center",
  description: "Security-first identity and access management control plane",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f7f9", color: "#17202a" }}>
        {children}
      </body>
    </html>
  );
}
