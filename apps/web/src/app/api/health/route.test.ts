import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSqlMock, sqlMock } = vi.hoisted(() => ({
  getSqlMock: vi.fn(),
  sqlMock: vi.fn(),
}));

vi.mock("../../../lib/db", () => ({
  getSql: getSqlMock,
}));

import { GET } from "./route";

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH0_DOMAIN", "");
    vi.stubEnv("AUTH0_CLIENT_ID", "");
    vi.stubEnv("DATABASE_URL", "postgres://iam_user:secret@localhost/iam");
    getSqlMock.mockReset();
    sqlMock.mockReset();
    getSqlMock.mockReturnValue(sqlMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns healthy only after a successful database query", async () => {
    sqlMock.mockResolvedValue([{ health_check: 1 }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      service: "iam-control-center-web",
      status: "healthy",
      authConfigured: false,
      databaseConfigured: true,
      databaseReachable: true,
    });
    expect(getSqlMock).toHaveBeenCalledOnce();
    expect(sqlMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  it("fails closed when DATABASE_URL is not configured", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.databaseConfigured).toBe(false);
    expect(body.databaseReachable).toBe(false);
    expect(getSqlMock).not.toHaveBeenCalled();
  });

  it("does not expose database provider errors", async () => {
    sqlMock.mockRejectedValue(
      new Error("connection failed: postgres://iam_user:secret@host/iam"),
    );

    const response = await GET();
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.status).toBe("unavailable");
    expect(body.databaseConfigured).toBe(true);
    expect(body.databaseReachable).toBe(false);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("connection failed");
  });
});
