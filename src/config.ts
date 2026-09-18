const requiredInProduction = ["DATABASE_URL", "JWT_ACCESS_SECRET", "CORS_ORIGIN"] as const;

export function validateEnvironment() {
  if (process.env.NODE_ENV === "production") {
    const missing = requiredInProduction.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
    }
  }

  if ((process.env.JWT_ACCESS_SECRET ?? "").length < 32 && process.env.NODE_ENV === "production") {
    throw new Error("JWT_ACCESS_SECRET must be at least 32 characters in production");
  }
}