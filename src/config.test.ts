import { describe, expect, it } from "vitest";
import { validateEnvironment } from "./config.js";

describe("production environment validation", () => {
  it("requires core production configuration when payment integrations are disabled", () => {
    const previous = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/freclean";
    process.env.JWT_ACCESS_SECRET = "1234567890abcdef1234567890abcdef";
    process.env.JWT_REFRESH_SECRET = "";
    process.env.ENQUIRY_SPAM_SECRET = "1234567890abcdef1234567890abcdef";
    process.env.CORS_ORIGIN = "https://freclean.com";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "FreClean <enquiries@example.com>";
    process.env.CARD_PROCESSOR_WEBHOOK_SECRET = "";
    delete process.env.CARD_PAYMENTS_ENABLED;
    delete process.env.CRYPTO_PAYMENTS_ENABLED;

    expect(() => validateEnvironment()).toThrow(/JWT_REFRESH_SECRET/);

    process.env.NODE_ENV = previous.NODE_ENV;
    process.env.DATABASE_URL = previous.DATABASE_URL;
    process.env.JWT_ACCESS_SECRET = previous.JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = previous.JWT_REFRESH_SECRET;
    process.env.ENQUIRY_SPAM_SECRET = previous.ENQUIRY_SPAM_SECRET;
    process.env.CORS_ORIGIN = previous.CORS_ORIGIN;
    process.env.RESEND_API_KEY = previous.RESEND_API_KEY;
    process.env.RESEND_FROM_EMAIL = previous.RESEND_FROM_EMAIL;
    process.env.CARD_PROCESSOR_WEBHOOK_SECRET = previous.CARD_PROCESSOR_WEBHOOK_SECRET;
    if (previous.CARD_PAYMENTS_ENABLED === undefined) delete process.env.CARD_PAYMENTS_ENABLED;
    else process.env.CARD_PAYMENTS_ENABLED = previous.CARD_PAYMENTS_ENABLED;
    if (previous.CRYPTO_PAYMENTS_ENABLED === undefined) delete process.env.CRYPTO_PAYMENTS_ENABLED;
    else process.env.CRYPTO_PAYMENTS_ENABLED = previous.CRYPTO_PAYMENTS_ENABLED;
  });

  it("requires payment credentials only when the integration is enabled", () => {
    const previous = { ...process.env };
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/freclean";
    process.env.JWT_ACCESS_SECRET = "1234567890abcdef1234567890abcdef";
    process.env.JWT_REFRESH_SECRET = "abcdef1234567890abcdef1234567890";
    process.env.ENQUIRY_SPAM_SECRET = "1234567890abcdef1234567890abcdef";
    process.env.CORS_ORIGIN = "https://freclean.com";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "FreClean <enquiries@example.com>";
    process.env.CARD_PAYMENTS_ENABLED = "true";
    process.env.CRYPTO_PAYMENTS_ENABLED = "false";
    delete process.env.CARD_PROCESSOR_API_KEY;
    delete process.env.CARD_PROCESSOR_WEBHOOK_SECRET;

    expect(() => validateEnvironment()).toThrow(/Card payments require/);

    process.env.CARD_PROCESSOR_API_KEY = "non-secret-placeholder";
    process.env.CARD_PROCESSOR_WEBHOOK_SECRET = "1234567890abcdef1234567890abcdef";
    expect(validateEnvironment()).toBe(true);

    process.env.NODE_ENV = previous.NODE_ENV;
    process.env.DATABASE_URL = previous.DATABASE_URL;
    process.env.JWT_ACCESS_SECRET = previous.JWT_ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = previous.JWT_REFRESH_SECRET;
    process.env.ENQUIRY_SPAM_SECRET = previous.ENQUIRY_SPAM_SECRET;
    process.env.CORS_ORIGIN = previous.CORS_ORIGIN;
    if (previous.RESEND_API_KEY === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous.RESEND_API_KEY;
    if (previous.RESEND_FROM_EMAIL === undefined) delete process.env.RESEND_FROM_EMAIL;
    else process.env.RESEND_FROM_EMAIL = previous.RESEND_FROM_EMAIL;
    if (previous.CARD_PAYMENTS_ENABLED === undefined) delete process.env.CARD_PAYMENTS_ENABLED;
    else process.env.CARD_PAYMENTS_ENABLED = previous.CARD_PAYMENTS_ENABLED;
    if (previous.CRYPTO_PAYMENTS_ENABLED === undefined) delete process.env.CRYPTO_PAYMENTS_ENABLED;
    else process.env.CRYPTO_PAYMENTS_ENABLED = previous.CRYPTO_PAYMENTS_ENABLED;
    if (previous.CARD_PROCESSOR_API_KEY === undefined) delete process.env.CARD_PROCESSOR_API_KEY;
    else process.env.CARD_PROCESSOR_API_KEY = previous.CARD_PROCESSOR_API_KEY;
    if (previous.CARD_PROCESSOR_WEBHOOK_SECRET === undefined) delete process.env.CARD_PROCESSOR_WEBHOOK_SECRET;
    else process.env.CARD_PROCESSOR_WEBHOOK_SECRET = previous.CARD_PROCESSOR_WEBHOOK_SECRET;
  });
});
