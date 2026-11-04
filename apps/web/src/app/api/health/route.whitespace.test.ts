import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/db", () => ({
  getSql: vi.fn(),
}));

import { GET } from "./route";

describe("GET /api/health whitespace configuration", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not treat whitespace-only values as configured or expose environment values", async () => {
    vi.stubEnv("AUTH0_DOMAIN", "   ");
    vi.stubEnv("AUTH0_CLIENT_ID", "\t");
    vi.stubEnv("AUTH0_CLIENT_SECRET", "private-auth0-secret");
    vi.stubEnv("AUTH0_SECRET", "private-session-secret");
    vi.stubEnv("DATABASE_URL", " \n ");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      service: "iam-control-center-web",
      status: "unavailable",
      authConfigured: false,
      databaseConfigured: false,
      databaseReachable: false,
    });

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("private-");
    expect(serialized).not.toContain("AUTH0");
    expect(serialized).not.toContain("DATABASE_URL");
  });
});
