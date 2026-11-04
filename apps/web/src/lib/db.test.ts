import { afterEach, describe, expect, it, vi } from "vitest";

const { neonMock } = vi.hoisted(() => ({
  neonMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@neondatabase/serverless", () => ({
  neon: neonMock,
}));

import { getSql } from "./db";

describe("getSql", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    neonMock.mockReset();
  });

  it("rejects an empty DATABASE_URL", () => {
    vi.stubEnv("DATABASE_URL", "");

    expect(() => getSql()).toThrow("DATABASE_URL is not configured");
    expect(neonMock).not.toHaveBeenCalled();
  });

  it("rejects a DATABASE_URL containing only whitespace", () => {
    vi.stubEnv("DATABASE_URL", "   ");

    expect(() => getSql()).toThrow("DATABASE_URL is not configured");
    expect(neonMock).not.toHaveBeenCalled();
  });

  it("creates the Neon client with DATABASE_URL", () => {
    const connectionString = "postgresql://user:secret@localhost/database";
    const sqlClient = vi.fn();

    vi.stubEnv("DATABASE_URL", connectionString);
    neonMock.mockReturnValue(sqlClient);

    expect(getSql()).toBe(sqlClient);
    expect(neonMock).toHaveBeenCalledOnce();
    expect(neonMock).toHaveBeenCalledWith(connectionString);
  });
});
