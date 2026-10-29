import { NextResponse } from "next/server";
import { getPublicRuntimeStatus } from "../../../lib/env";

export function GET() {
  const runtime = getPublicRuntimeStatus();
  const configured = runtime.authConfigured && runtime.databaseConfigured;

  return NextResponse.json(
    {
      ok: true,
      service: "iam-control-center-web",
      status: configured ? "configured_presence_only" : "degraded",
      checkedAt: new Date().toISOString(),
      checks: {
        http: { status: "pass", detail: "O endpoint de saúde respondeu." },
        auth0Environment: {
          status: runtime.authConfigured ? "configured" : "missing_configuration",
          detail: "Verifica apenas a presença das variáveis públicas de configuração; não testa login.",
        },
        databaseEnvironment: {
          status: runtime.databaseConfigured ? "configured" : "missing_configuration",
          detail: "Verifica apenas a presença da variável de conexão; não abre conexão com PostgreSQL.",
        },
      },
      ...runtime,
      limitations: [
        "Não valida autenticação OIDC ponta a ponta.",
        "Não valida conectividade, schema, privilégios ou RLS do PostgreSQL.",
        "Não executa migrations nem altera dados.",
      ],
    },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
