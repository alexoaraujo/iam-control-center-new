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
    vi.stubEnv("DATABASE_URL", "postgres://user:password@localhost/db");
    const result = getPublicRuntimeStatus();
    expect(JSON.stringify(result)).not.toContain("password");
    expect(result).toEqual({ authConfigured: true, databaseConfigured: true });
  });
});
