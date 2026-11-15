const requiredInProduction = [
  "DATABASE_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "CONTACT_EMAIL",
  "CORS_ORIGIN",
  "ENQUIRY_SPAM_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
] as const;

const minimumSecretLength = 32;
const usdtRpcVariables = ["BSC_RPC_URL", "TRON_RPC_URL", "SOLANA_RPC_URL", "CELO_RPC_URL"] as const;

export function validateEnvironment() {
  const environment = process.env.NODE_ENV ?? "development";

  if (environment === "production") {
    const missing = requiredInProduction.filter((name) => !String(process.env[name] ?? "").trim());
    if (missing.length > 0) {
      throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
    }

    if (process.env.CONTACT_EMAIL?.trim().toLowerCase() !== "contact@freclean.com") {
      throw new Error("CONTACT_EMAIL must be contact@freclean.com in production");
    }

    if (process.env.USDT_PAYMENTS_ENABLED === "true") {
      const missingRpc = usdtRpcVariables.filter((name) => !String(process.env[name] ?? "").trim());
      if (missingRpc.length > 0) {
        throw new Error(`USDT payments require: ${missingRpc.join(", ")}`);
      }
      const invalidRpc = usdtRpcVariables.filter((name) => {
        try {
          return new URL(process.env[name]!).protocol !== "https:";
        } catch {
          return true;
        }
      });
      if (invalidRpc.length > 0) {
        throw new Error(`Production blockchain RPC endpoints must use HTTPS: ${invalidRpc.join(", ")}`);
      }
    }
    if (process.env.CELOHT_DAPP_URL?.trim()) {
      try {
        const dappUrl = new URL(process.env.CELOHT_DAPP_URL);
        if (dappUrl.protocol !== "https:" || dappUrl.username || dappUrl.password) throw new Error();
      } catch {
        throw new Error("CELOHT_DAPP_URL must be an HTTPS URL without embedded credentials");
      }
    }

    const invalidSecrets = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "ENQUIRY_SPAM_SECRET"]
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
    }
    if (origins.some((origin) => origin !== "https://freclean.com")) {
      throw new Error("CORS_ORIGIN must be exactly https://freclean.com in production");
    }
  }

  return true;
}