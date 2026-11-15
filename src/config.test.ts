import { afterEach, describe, expect, it } from "vitest";
import { validateEnvironment } from "./config.js";

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

function setProductionEnvironment() {
  process.env.NODE_ENV = "production";
  process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/freclean";
  process.env.JWT_ACCESS_SECRET = "1234567890abcdef1234567890abcdef";
  process.env.JWT_REFRESH_SECRET = "abcdef1234567890abcdef1234567890";
  process.env.CONTACT_EMAIL = "contact@freclean.com";
  process.env.ENQUIRY_SPAM_SECRET = "1234567890abcdef1234567890abcdef";
  process.env.CORS_ORIGIN = "https://freclean.com";
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "FreClean <enquiries@example.com>";
  process.env.USDT_PAYMENTS_ENABLED = "false";
}

describe("production environment validation", () => {
  it("allows disabled payment integrations without payment-provider credentials", () => {
    setProductionEnvironment();
    delete process.env.USDT_PAYMENTS_ENABLED;
    expect(validateEnvironment()).toBe(true);
  });

  it("requires secure RPC endpoints only when USDT payments are enabled", () => {
    setProductionEnvironment();
    process.env.USDT_PAYMENTS_ENABLED = "true";
    delete process.env.BSC_RPC_URL;
    expect(() => validateEnvironment()).toThrow(/BSC_RPC_URL/);

    process.env.BSC_RPC_URL = "https://bsc-rpc.example";
    process.env.TRON_RPC_URL = "https://tron-rpc.example";
    process.env.SOLANA_RPC_URL = "https://solana-rpc.example";
    process.env.CELO_RPC_URL = "https://celo-rpc.example";
    expect(validateEnvironment()).toBe(true);

    process.env.SOLANA_RPC_URL = "http://solana-rpc.example";
    expect(() => validateEnvironment()).toThrow(/must use HTTPS/);
  });

  it("rejects invalid production email, CORS, or authentication configuration", () => {
    setProductionEnvironment();
    process.env.JWT_REFRESH_SECRET = "";
    expect(() => validateEnvironment()).toThrow(/JWT_REFRESH_SECRET/);

    setProductionEnvironment();
    process.env.CONTACT_EMAIL = "another@example.com";
    expect(() => validateEnvironment()).toThrow(/CONTACT_EMAIL must be contact@freclean\.com/);
  });

  it("fails clearly for missing or malformed Resend settings without exposing values", () => {
    setProductionEnvironment();
    delete process.env.RESEND_API_KEY;
    expect(() => validateEnvironment()).toThrow(/RESEND_API_KEY/);

    setProductionEnvironment();
    process.env.RESEND_API_KEY = "private-invalid-api-key";
    expect(() => validateEnvironment()).toThrow(/RESEND_API_KEY is invalid/);

    setProductionEnvironment();
    process.env.RESEND_FROM_EMAIL = "not-an-email";
    expect(() => validateEnvironment()).toThrow(/RESEND_FROM_EMAIL is invalid/);
  });
});
