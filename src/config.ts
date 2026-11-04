const requiredInProduction = [
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "CORS_ORIGIN",
  "ENQUIRY_SPAM_SECRET",
] as const;

const minimumSecretLength = 32;

export function validateEnvironment() {
  const environment = process.env.NODE_ENV ?? "development";

  if (environment === "production") {
    const missing = requiredInProduction.filter((name) => !String(process.env[name] ?? "").trim());
    if (missing.length > 0) {
      throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
    }

    if (process.env.CARD_PAYMENTS_ENABLED === "true") {
      const missingCard = ["CARD_PROCESSOR_API_KEY", "CARD_PROCESSOR_WEBHOOK_SECRET"]
        .filter((name) => !String(process.env[name] ?? "").trim());
      if (missingCard.length > 0) {
        throw new Error(`Card payments require: ${missingCard.join(", ")}`);
      }
    }

    if (process.env.CRYPTO_PAYMENTS_ENABLED === "true") {
      const missingCrypto = ["CELO_RPC_URL", "USDM_CONTRACT_ADDRESS", "CELO_RECEIVING_ADDRESS"]
        .filter((name) => !String(process.env[name] ?? "").trim());
      if (missingCrypto.length > 0) {
        throw new Error(`Crypto payments require: ${missingCrypto.join(", ")}`);
      }
    }

    const invalidSecrets = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "ENQUIRY_SPAM_SECRET", "CARD_PROCESSOR_WEBHOOK_SECRET"]
      .filter((name) => (process.env[name] ?? "").length < minimumSecretLength);
    if (invalidSecrets.length > 0) {
      throw new Error(`Production secrets must be at least ${minimumSecretLength} characters: ${invalidSecrets.join(", ")}`);
    }

    const origins = String(process.env.CORS_ORIGIN ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean);

    if (origins.length === 0 || !origins.every((origin) => /^https?:\/\//.test(origin) || origin === "localhost")) {
      throw new Error("CORS_ORIGIN must include at least one valid production origin");
    }    if (origins.some((origin) => origin !== "https://freclean.com")) {
      throw new Error("CORS_ORIGIN must be exactly https://freclean.com in production");
    }  }

  return true;
}