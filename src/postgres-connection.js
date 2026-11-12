import { X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";

const sslParameters = new Set([
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "sslaccept",
]);

function isSupabaseHostname(hostname) {
  return hostname.endsWith(".supabase.co") || hostname.endsWith(".pooler.supabase.com");
}

function withoutUrlSslParameters(url) {
  for (const key of [...url.searchParams.keys()]) {
    if (sslParameters.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  return url.toString();
}

/**
 * @param {string} connectionString
 * @param {string | undefined} supabaseCaCertificate
 */
export function getPostgresConnectionConfig(connectionString, supabaseCaCertificate) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL");
  }

  const hostname = url.hostname.toLowerCase();
  if (isSupabaseHostname(hostname)) {
    if (!supabaseCaCertificate?.trim()) {
      throw Object.assign(
        new Error("SUPABASE_CA_CERT is required for Supabase PostgreSQL connections"),
        { code: "SUPABASE_CA_CERT_REQUIRED" },
      );
    }

    const ca = supabaseCaCertificate.replace(/\\n/g, "\n").trim();
    try {
      const certificateBlocks = ca.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
      const remainingText = ca.replace(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g, "").trim();
      if (certificateBlocks.length === 0 || remainingText) throw new Error();
      for (const certificate of certificateBlocks) new X509Certificate(certificate);
      createSecureContext({ ca });
    } catch {
      throw Object.assign(
        new Error("SUPABASE_CA_CERT must contain a valid PEM-encoded CA certificate"),
        { code: "SUPABASE_CA_CERT_INVALID" },
      );
    }

    return {
      connectionString: withoutUrlSslParameters(url),
      ssl: { ca, rejectUnauthorized: true },
    };
  }

  if (hostname.endsWith(".render.com")) {
    return {
      connectionString: withoutUrlSslParameters(url),
      ssl: { rejectUnauthorized: true },
    };
  }

  return { connectionString, ssl: undefined };
}
