import jwt from "jsonwebtoken";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const dbQuery = vi.hoisted(() => vi.fn());
vi.mock("../db.js", () => ({ query: dbQuery }));

let refreshAccessToken: typeof import("./service.js").refreshAccessToken;
let login: typeof import("./service.js").login;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET = "test-access-secret-that-is-at-least-32-chars";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret-that-is-at-least-32-chars";
  ({ refreshAccessToken, login } = await import("./service.js"));
});

describe("refresh token validation", () => {
  beforeEach(() => dbQuery.mockReset());

  it("accepts a refresh token using the account's current active roles", async () => {
    const token = jwt.sign(
      { sub: "user-1", roles: ["CUSTOMER"], type: "refresh" },
      process.env.JWT_REFRESH_SECRET!
    );
    dbQuery
      .mockResolvedValueOnce([{ status: "ACTIVE" }])
      .mockResolvedValueOnce([{ name: "MANAGER" }]);

    const accessToken = await refreshAccessToken(token);
    expect(jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET!)).toMatchObject({
      sub: "user-1",
      roles: ["MANAGER"],
    });
  });

  it("rejects a JWT without refresh-token type", async () => {
    const token = jwt.sign(
      { sub: "user-1", roles: ["CUSTOMER"] },
      process.env.JWT_REFRESH_SECRET!
    );

    await expect(refreshAccessToken(token)).rejects.toThrow("Invalid refresh token");
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it("rejects refresh for a suspended account", async () => {
    const token = jwt.sign(
      { sub: "user-1", roles: ["CUSTOMER"], type: "refresh" },
      process.env.JWT_REFRESH_SECRET!
    );
    dbQuery.mockResolvedValueOnce([{ status: "SUSPENDED" }]);

    await expect(refreshAccessToken(token)).rejects.toMatchObject({ status: 401 });
    expect(dbQuery).toHaveBeenCalledOnce();
  });

  it("rejects login for a suspended account", async () => {
    dbQuery.mockResolvedValueOnce([{
      id: "user-1",
      email: "suspended@example.com",
      password_hash: "unused",
      full_name: "Suspended User",
      status: "SUSPENDED",
    }]);

    await expect(login("suspended@example.com", "a sufficiently long password")).rejects.toMatchObject({
      status: 401,
      message: "Invalid credentials",
    });
  });
});
