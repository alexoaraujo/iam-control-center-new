import { afterEach, describe, expect, it, vi } from "vitest";

const { getSqlMock } = vi.hoisted(() => ({
  getSqlMock: vi.fn(),
}));

vi.mock("../../../../lib/db", () => ({
  getSql: getSqlMock,
}));

import { GET } from "./route";

describe("GET /api/health/database", () => {
  afterEach(() => getSqlMock.mockReset());

  it("returns 200 only after SELECT 1 succeeds", async () => {
    const query = vi.fn().mockResolvedValue([{ alive: 1 }]);
    getSqlMock.mockReturnValue(query);

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: true, database: "reachable" });
    expect(query).toHaveBeenCalledOnce();
    expect(query.mock.calls[0][0].join("")).toBe("SELECT 1 AS alive");
  });

  it("returns 503 and does not leak database error details", async () => {
    const query = vi.fn().mockRejectedValue(
      new Error("postgres://secret-role:secret-password@secret-host/database"),
    );
    getSqlMock.mockReturnValue(query);

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({ ok: false, database: "unreachable" });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("fails closed when the database connection is not configured", async () => {
    getSqlMock.mockImplementation(() => {
      throw new Error("DATABASE_URL is not configured");
    });

    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, database: "unreachable" });
  });

  it("rejects unexpected query results", async () => {
    getSqlMock.mockReturnValue(vi.fn().mockResolvedValue([]));
    const response = await GET();
    expect(response.status).toBe(503);
  });
});
