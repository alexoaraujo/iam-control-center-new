import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports runtime configuration presence without exposing environment values", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "example.auth0.com");
    vi.stubEnv("AUTH0_CLIENT_ID", "public-client-id");
    vi.stubEnv("AUTH0_CLIENT_SECRET", "must-not-appear-client-secret");
    vi.stubEnv("AUTH0_SECRET", "must-not-appear-session-secret");
    vi.stubEnv(
      "DATABASE_URL",
      "postgres://iam_user:must-not-appear-db-password@localhost/iam",
    );

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(
      expect.objectContaining({
        ok: true,
        service: "iam-control-center-web",
        status: "configured_presence_only",
        authConfigured: true,
        databaseConfigured: true,
        checks: {
          http: expect.objectContaining({ status: "pass" }),
          auth0Environment: expect.objectContaining({ status: "configured" }),
          databaseEnvironment: expect.objectContaining({ status: "configured" }),
        },
        limitations: expect.arrayContaining([
          expect.stringContaining("Não valida autenticação OIDC"),
          expect.stringContaining("Não valida conectividade"),
        ]),
      }),
    );

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("must-not-appear");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("example.auth0.com");
  });

  it("reports each integration independently when configuration is partial", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "example.auth0.com");
    vi.stubEnv("AUTH0_CLIENT_ID", "");
    vi.stubEnv("DATABASE_URL", "postgres://user:password@localhost/iam");

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authConfigured).toBe(false);
    expect(body.databaseConfigured).toBe(true);
    expect(body.status).toBe("degraded");
    expect(body.checks.auth0Environment.status).toBe("missing_configuration");
    expect(body.checks.databaseEnvironment.status).toBe("configured");
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  it("reports degraded status when required configuration is absent", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "");
    vi.stubEnv("AUTH0_CLIENT_ID", "");
    vi.stubEnv("DATABASE_URL", "");

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authConfigured).toBe(false);
    expect(body.databaseConfigured).toBe(false);
    expect(body.status).toBe("degraded");
    expect(body.checks.http.status).toBe("pass");
    expect(body.checks.auth0Environment.status).toBe("missing_configuration");
    expect(body.checks.databaseEnvironment.status).toBe("missing_configuration");
  });
});
