import type { PaymentNetwork } from "./model.js";

const evmReceivingAddress = "0xcbe30a91dbc6a2423c30d8c8dd0547b8dcb0e044";

export const usdtNetworkConfig = {
  BEP20: {
    label: "BNB Smart Chain",
    receivingAddress: evmReceivingAddress,
    tokenIdentifier: "0x55d398326f99059ff775485246999027b3197955",
    decimals: 18,
    confirmations: 12,
    explorer: "https://bscscan.com/tx/",
    rpcEnvironmentVariable: "BSC_RPC_URL",
  },
  TRC20: {
    label: "TRON",
    receivingAddress: "TSnbTib4DAEpGbesxUzjN2pgtcJigs8veR",
    tokenIdentifier: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    decimals: 6,
    confirmations: 20,
    explorer: "https://tronscan.org/#/transaction/",
    rpcEnvironmentVariable: "TRON_RPC_URL",
  },
  SOLANA: {
    label: "Solana",
    receivingAddress: "33FM1eKWBNWfA6qDf1EFZ8Ab6U6RiXhJkG6NyFL1wTYf",
    tokenIdentifier: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
    decimals: 6,
    confirmations: 1,
    explorer: "https://explorer.solana.com/tx/",
    rpcEnvironmentVariable: "SOLANA_RPC_URL",
  },
  CELO: {
    label: "Celo",
    receivingAddress: evmReceivingAddress,
    tokenIdentifier: "0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e",
    decimals: 6,
    confirmations: 3,
    explorer: "https://celoscan.io/tx/",
    rpcEnvironmentVariable: "CELO_RPC_URL",
  },
} as const satisfies Record<PaymentNetwork, {
  label: string;
  receivingAddress: string;
  tokenIdentifier: string;
  decimals: number;
  confirmations: number;
  explorer: string;
  rpcEnvironmentVariable: string;
}>;

export function getPaymentNetworkConfig(network: PaymentNetwork) {
  return usdtNetworkConfig[network];
}

export function getRpcUrl(network: PaymentNetwork): string {
  const name = getPaymentNetworkConfig(network).rpcEnvironmentVariable;
  const value = process.env[name]?.trim();
  if (!value) {
    throw Object.assign(new Error(`Payment verification is not configured for ${network}`), { status: 503 });
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Object.assign(new Error(`${name} must be a valid HTTPS URL`), { status: 500 });
  }
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw Object.assign(new Error(`${name} must use HTTPS in production`), { status: 500 });
  }
  return value;
}
