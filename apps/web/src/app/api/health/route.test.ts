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

  it("returns healthy only when the database is reachable through the expected runtime role", async () => {
    sqlMock.mockResolvedValue([{ runtime_role_verified: true }]);

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
      databaseRoleVerified: true,
    });
    expect(getSqlMock).toHaveBeenCalledOnce();
    expect(sqlMock).toHaveBeenCalledOnce();
    expect(JSON.stringify(body)).not.toContain("secret");
    expect(JSON.stringify(body)).not.toContain("postgres://");
    expect(sqlMock.mock.calls[0]).toBeDefined();
  });

  it("fails readiness when the database is reachable through an unexpected role", async () => {
    sqlMock.mockResolvedValue([{ runtime_role_verified: false }]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.databaseReachable).toBe(true);
    expect(body.databaseRoleVerified).toBe(false);
  });

  it("fails closed when DATABASE_URL is not configured", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.databaseConfigured).toBe(false);
    expect(body.databaseReachable).toBe(false);
    expect(body.databaseRoleVerified).toBe(false);
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
    expect(body.databaseRoleVerified).toBe(false);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("postgres://");
    expect(serialized).not.toContain("connection failed");
  });
});
