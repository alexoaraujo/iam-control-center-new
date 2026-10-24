import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns scaffold status and only public configuration booleans", async () => {
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
    expect(body).toEqual({
      ok: true,
      service: "iam-control-center-web",
      status: "scaffold",
      authConfigured: true,
      databaseConfigured: true,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("must-not-appear");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("example.auth0.com");
  });

  it("reports integrations as unconfigured when required values are absent", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "");
    vi.stubEnv("AUTH0_CLIENT_ID", "");
    vi.stubEnv("DATABASE_URL", "");

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.authConfigured).toBe(false);
    expect(body.databaseConfigured).toBe(false);
    expect(body.status).toBe("scaffold");
  });
});
