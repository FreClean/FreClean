import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./config.js";

describe("production environment validation", () => {
  it("requires the full production auth and payment configuration", () => {
    const previous = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/freclean";
    process.env.JWT_ACCESS_SECRET = "1234567890abcdef1234567890abcdef";
    process.env.JWT_REFRESH_SECRET = "";
    process.env.CORS_ORIGIN = "https://app.example.com";
    process.env.CARD_PROCESSOR_WEBHOOK_SECRET = "";

    expect(() => validateEnvironment()).toThrow(/JWT_REFRESH_SECRET|CARD_PROCESSOR_WEBHOOK_SECRET/);

    process.env.NODE_ENV = previous.NODE_ENV;
    process.env.DATABASE_URL = previous.DATABASE_URL;
    process.env.JWT_ACCESS_SECRET = previous.JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = previous.JWT_REFRESH_SECRET;
    process.env.CORS_ORIGIN = previous.CORS_ORIGIN;
    process.env.CARD_PROCESSOR_WEBHOOK_SECRET = previous.CARD_PROCESSOR_WEBHOOK_SECRET;
  });
});
