import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import { requireAuthentication } from "./middleware.js";

function response() {
  const result = { statusCode: 200, body: undefined as unknown };
  return {
    result,
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(body: unknown) {
      result.body = body;
      return this;
    },
  };
}

describe("JWT authentication middleware", () => {
  it("rejects missing credentials", () => {
    const res = response();
    const next = () => undefined;
    requireAuthentication({ header: () => undefined } as never, res as never, next);

    expect(res.result.statusCode).toBe(401);
  });

  it("accepts a signed token and attaches only signed identity data", () => {
    process.env.JWT_ACCESS_SECRET = "test-secret";
    const token = jwt.sign({ roles: ["CUSTOMER"] }, "test-secret", { subject: "user-1" });
    const req = { header: (name: string) => name === "Authorization" ? `Bearer ${token}` : undefined } as never;
    const res = response();
    let called = false;

    requireAuthentication(req, res as never, () => { called = true; });

    expect(called).toBe(true);
    expect((req as { user?: { id: string } }).user?.id).toBe("user-1");
  });
});
