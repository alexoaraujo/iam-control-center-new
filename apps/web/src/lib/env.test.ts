import { afterEach, describe, expect, it, vi } from "vitest";
import { getPublicRuntimeStatus } from "./env";

describe("getPublicRuntimeStatus", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reports integrations as unconfigured when values are absent", () => {
    vi.stubEnv("AUTH0_DOMAIN", "");
    vi.stubEnv("AUTH0_CLIENT_ID", "");
    vi.stubEnv("DATABASE_URL", "");
    expect(getPublicRuntimeStatus()).toEqual({
      authConfigured: false,
      databaseConfigured: false,
    });
  });

  it("reports integrations as unconfigured when values contain only whitespace", () => {
    vi.stubEnv("AUTH0_DOMAIN", "   ");
    vi.stubEnv("AUTH0_CLIENT_ID", "\t");
    vi.stubEnv("DATABASE_URL", " \n ");

    expect(getPublicRuntimeStatus()).toEqual({
      authConfigured: false,
      databaseConfigured: false,
    });
  });

  it("does not expose secret values in its result", () => {
    vi.stubEnv("AUTH0_DOMAIN", "example.auth0.com");
    vi.stubEnv("AUTH0_CLIENT_ID", "public-client-id");
    vi.stubEnv("AUTH0_CLIENT_SECRET", "client-secret");
    vi.stubEnv("AUTH0_SECRET", "session-secret");
    vi.stubEnv("APP_BASE_URL", "https://example.com");
    vi.stubEnv("DATABASE_URL", "postgres://user:password@localhost/db");
    const result = getPublicRuntimeStatus();
    expect(JSON.stringify(result)).not.toContain("password");
    expect(result).toEqual({ authConfigured: true, databaseConfigured: true });
  });
});

describe("Auth0 configuration completeness", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["AUTH0_DOMAIN", "AUTH0_CLIENT_ID", "AUTH0_CLIENT_SECRET", "AUTH0_SECRET", "APP_BASE_URL"])(
    "fails closed when %s is missing",
    (missingKey) => {
      const values = {
        AUTH0_DOMAIN: "example.auth0.com",
        AUTH0_CLIENT_ID: "public-client-id",
        AUTH0_CLIENT_SECRET: "client-secret",
        AUTH0_SECRET: "session-secret",
        APP_BASE_URL: "https://example.com",
      };
      for (const [key, value] of Object.entries(values)) vi.stubEnv(key, key === missingKey ? "" : value);
      expect(getPublicRuntimeStatus().authConfigured).toBe(false);
    },
  );
});
