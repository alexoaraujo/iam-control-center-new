import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicRuntimeStatus } from "./env";

describe("getPublicRuntimeStatus", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports integrations as unconfigured when values are absent", () => {
    vi.stubEnv("AUTH0_DOMAIN", "");
    vi.stubEnv("AUTH0_CLIENT_ID", "");
    vi.stubEnv("AUTH0_CLIENT_SECRET", "");
    vi.stubEnv("AUTH0_SECRET", "");
    vi.stubEnv("APP_BASE_URL", "");
    vi.stubEnv("DATABASE_URL", "");
    expect(getPublicRuntimeStatus()).toEqual({
      authConfigured: false,
      databaseConfigured: false,
    });
  });

  it("reports integrations as unconfigured when values contain only whitespace", () => {
    vi.stubEnv("AUTH0_DOMAIN", "   ");
    vi.stubEnv("AUTH0_CLIENT_ID", "\t");
    vi.stubEnv("AUTH0_CLIENT_SECRET", " ");
    vi.stubEnv("AUTH0_SECRET", "\n");
    vi.stubEnv("APP_BASE_URL", "  ");
    vi.stubEnv("DATABASE_URL", " \n ");

    expect(getPublicRuntimeStatus()).toEqual({
      authConfigured: false,
      databaseConfigured: false,
    });
  });

  it("requires every Auth0 runtime variable without exposing values", () => {
    vi.stubEnv("AUTH0_DOMAIN", "example.auth0.com");
    vi.stubEnv("AUTH0_CLIENT_ID", "public-client-id");
    vi.stubEnv("AUTH0_CLIENT_SECRET", "client-secret");
    vi.stubEnv("AUTH0_SECRET", "session-secret");
    vi.stubEnv("APP_BASE_URL", "https://example.com");
    vi.stubEnv("DATABASE_URL", "postgres://user:password@localhost/db");
    expect(getPublicRuntimeStatus()).toEqual({
      authConfigured: true,
      databaseConfigured: true,
    });
    expect(JSON.stringify(getPublicRuntimeStatus())).not.toContain("secret");
    expect(JSON.stringify(getPublicRuntimeStatus())).not.toContain("password");
  });

  it("reports Auth0 incomplete when a required secret is missing", () => {
    vi.stubEnv("AUTH0_DOMAIN", "example.auth0.com");
    vi.stubEnv("AUTH0_CLIENT_ID", "public-client-id");
    vi.stubEnv("AUTH0_CLIENT_SECRET", "");
    vi.stubEnv("AUTH0_SECRET", "session-secret");
    vi.stubEnv("APP_BASE_URL", "https://example.com");
    vi.stubEnv("DATABASE_URL", "postgres://user:password@localhost/db");
    expect(getPublicRuntimeStatus()).toEqual({
      authConfigured: false,
      databaseConfigured: true,
    });
  });
});
