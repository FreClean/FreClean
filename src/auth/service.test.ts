import jwt from "jsonwebtoken";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", () => ({
  query: vi.fn(),
}));

let refreshAccessToken: typeof import("./service.js").refreshAccessToken;

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://test:test@localhost:5432/test";
  process.env.JWT_ACCESS_SECRET = "test-access-secret-that-is-at-least-32-chars";
  process.env.JWT_REFRESH_SECRET = "test-refresh-secret-that-is-at-least-32-chars";
  ({ refreshAccessToken } = await import("./service.js"));
});

describe("refresh token validation", () => {
  it("accepts a refresh-token claim", () => {
    const token = jwt.sign(
      { sub: "user-1", roles: ["CUSTOMER"], type: "refresh" },
      process.env.JWT_REFRESH_SECRET!
    );

    expect(() => refreshAccessToken(token)).not.toThrow();
  });

  it("rejects a JWT without refresh-token type", () => {
    const token = jwt.sign(
      { sub: "user-1", roles: ["CUSTOMER"] },
      process.env.JWT_REFRESH_SECRET!
    );

    expect(() => refreshAccessToken(token)).toThrow("Invalid refresh token");
  });
});
