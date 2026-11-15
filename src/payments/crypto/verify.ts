import { createHash } from "node:crypto";
import { getPaymentNetworkConfig, getRpcUrl } from "../config.js";
import type { PaymentNetwork } from "../model.js";

const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export type ChainVerification =
  | { status: "PAID"; confirmations: number }
  | { status: "VERIFYING"; confirmations: number }
  | { status: "FAILED"; confirmations: number; reason: string };

interface ExpectedTransfer {
  network: PaymentNetwork;
  transactionHash: string;
  amount: string;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code?: number; message?: string };
}

async function postJson<T>(url: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "request_error";
    throw Object.assign(new Error(`Blockchain provider request failed: ${reason}`), { status: 502 });
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Blockchain provider returned HTTP ${response.status}`), { status: 502 });
  }
  return response.json() as Promise<T>;
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const response = await postJson<JsonRpcResponse<T>>(url, {
    jsonrpc: "2.0",
    id: 1,
    method,
    params,
  });
  if (response.error) {
    throw Object.assign(new Error(`Blockchain provider RPC error: ${response.error.code ?? "unknown"}`), { status: 502 });
  }
  if (response.result === undefined) {
    throw Object.assign(new Error("Blockchain provider returned no result"), { status: 502 });
  }
  return response.result;
}

function usdtBaseUnits(amount: string, decimals: number): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(amount)) {
    throw new Error("Payment amount must be a positive USDT decimal");
  }
  const [whole = "0", fraction = ""] = amount.split(".");
  const units = BigInt(whole) * 10n ** BigInt(decimals) +
    BigInt(fraction.slice(0, decimals).padEnd(decimals, "0"));
  if (fraction.length > decimals && /[1-9]/.test(fraction.slice(decimals))) {
    throw new Error("Payment amount has more precision than the network token supports");
  }
  if (units <= 0n) throw new Error("Payment amount must be greater than zero");
  return units;
}

function validEvmHash(hash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}

function asHexInteger(value: string): bigint | null {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) return null;
  return BigInt(value);
}

async function verifyEvm(expected: ExpectedTransfer): Promise<ChainVerification> {
  const network = expected.network;
  const config = getPaymentNetworkConfig(network);
  const url = getRpcUrl(network);
  const chainId = network === "BEP20" ? 56n : 42220n;
  const observedChainId = asHexInteger(await rpc<string>(url, "eth_chainId", []));
  if (observedChainId !== chainId) {
    throw Object.assign(new Error(`Configured RPC endpoint is not the ${config.label} mainnet`), { status: 500 });
  }
  if (!validEvmHash(expected.transactionHash)) {
    return { status: "FAILED", confirmations: 0, reason: "invalid transaction hash" };
  }

  const receipt = await rpc<{
    status?: string;
    blockNumber?: string;
    logs?: Array<{ address?: string; topics?: string[]; data?: string }>;
  } | null>(url, "eth_getTransactionReceipt", [expected.transactionHash]);
  if (!receipt) {
    const alternateNetwork = network === "BEP20" ? "CELO" : "BEP20";
    const alternateUrl = process.env[getPaymentNetworkConfig(alternateNetwork).rpcEnvironmentVariable]?.trim();
    if (alternateUrl) {
      const alternateChainId = alternateNetwork === "BEP20" ? "0x38" : "0xa4ec";
      if (asHexInteger(await rpc<string>(alternateUrl, "eth_chainId", [])) !== BigInt(alternateChainId)) {
        throw Object.assign(new Error(`Configured RPC endpoint is not the ${getPaymentNetworkConfig(alternateNetwork).label} mainnet`), { status: 500 });
      }
      const alternateReceipt = await rpc<unknown | null>(alternateUrl, "eth_getTransactionReceipt", [expected.transactionHash]);
      if (alternateReceipt) {
        return { status: "FAILED", confirmations: 0, reason: "transaction was sent on a different network" };
      }
    }
    return { status: "VERIFYING", confirmations: 0 };
  }
  const blockNumber = receipt.blockNumber ? asHexInteger(receipt.blockNumber) : null;
  const latestBlock = asHexInteger(await rpc<string>(url, "eth_blockNumber", []));
  if (blockNumber === null || latestBlock === null || latestBlock < blockNumber) {
    return { status: "VERIFYING", confirmations: 0 };
  }
  const confirmations = Number(latestBlock - blockNumber + 1n);
  if (confirmations < config.confirmations) return { status: "VERIFYING", confirmations };
  if (receipt.status !== "0x1") {
    return { status: "FAILED", confirmations, reason: "transaction failed" };
  }

  const tokenAddress = config.tokenIdentifier.toLowerCase();
  const recipient = config.receivingAddress.toLowerCase();
  const paid = (receipt.logs ?? []).reduce((total, log) => {
    const topics = log.topics ?? [];
    if (
      log.address?.toLowerCase() !== tokenAddress ||
      topics[0]?.toLowerCase() !== transferTopic ||
      `0x${topics[2]?.slice(-40).toLowerCase()}` !== recipient ||
      !log.data ||
      !/^0x[0-9a-fA-F]+$/.test(log.data)
    ) return total;
    return total + BigInt(log.data);
  }, 0n);
  if (paid < usdtBaseUnits(expected.amount, config.decimals)) {
    return { status: "FAILED", confirmations, reason: "USDT amount, token, or recipient did not match" };
  }
  return { status: "PAID", confirmations };
}

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58Check(address: string): Buffer {
  let value = 0n;
  for (const character of address) {
    const digit = base58Alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid base58 address");
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value & 255n));
    value >>= 8n;
  }
  const leadingZeroes = address.match(/^1+/)?.[0].length ?? 0;
  const decoded = Buffer.from([...Array(leadingZeroes).fill(0), ...bytes]);
  if (decoded.length !== 25) throw new Error("Invalid TRON address length");
  const payload = decoded.subarray(0, 21);
  const checksum = createHash("sha256").update(createHash("sha256").update(payload).digest()).digest().subarray(0, 4);
  if (!checksum.equals(decoded.subarray(21))) throw new Error("Invalid TRON address checksum");
  return payload;
}

async function verifyTron(expected: ExpectedTransfer): Promise<ChainVerification> {
  const config = getPaymentNetworkConfig("TRC20");
  const url = getRpcUrl("TRC20").replace(/\/+$/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(expected.transactionHash)) {
    return { status: "FAILED", confirmations: 0, reason: "invalid transaction hash" };
  }
  const headers: Record<string, string> = {};
  if (process.env.TRONGRID_API_KEY) headers["TRON-PRO-API-KEY"] = process.env.TRONGRID_API_KEY;
  const [info, block] = await Promise.all([
    postJson<{
      id?: string;
      blockNumber?: number;
      receipt?: { result?: string };
      log?: Array<{ address?: string; topics?: string[]; data?: string }>;
    }>(`${url}/walletsolidity/gettransactioninfobyid`, { value: expected.transactionHash }, headers),
    postJson<{ block_header?: { raw_data?: { number?: number } } }>(`${url}/wallet/getnowblock`, {}, headers),
  ]);
  if (!info.id) return { status: "VERIFYING", confirmations: 0 };
  const currentBlock = block.block_header?.raw_data?.number;
  const confirmations = typeof currentBlock === "number" && typeof info.blockNumber === "number"
    ? Math.max(0, currentBlock - info.blockNumber + 1)
    : 0;
  if (confirmations < config.confirmations) return { status: "VERIFYING", confirmations };
  if (info.receipt?.result !== "SUCCESS") {
    return { status: "FAILED", confirmations, reason: "transaction failed" };
  }

  const expectedToken = decodeBase58Check(config.tokenIdentifier).toString("hex").toLowerCase();
  const expectedRecipient = decodeBase58Check(config.receivingAddress).toString("hex").slice(2).toLowerCase();
  const paid = (info.log ?? []).reduce((total, log) => {
    const topics = log.topics ?? [];
    const token = log.address?.toLowerCase().replace(/^0x/, "");
    const recipient = topics[2]?.slice(-40).toLowerCase();
    if (
      token !== expectedToken &&
      token !== expectedToken.slice(2)
    ) return total;
    if (topics[0]?.toLowerCase() !== transferTopic || recipient !== expectedRecipient) return total;
    if (!log.data || !/^[0-9a-fA-F]+$/.test(log.data)) return total;
    return total + BigInt(`0x${log.data}`);
  }, 0n);
  if (paid < usdtBaseUnits(expected.amount, config.decimals)) {
    return { status: "FAILED", confirmations, reason: "USDT amount, token, or recipient did not match" };
  }
  return { status: "PAID", confirmations };
}

async function verifySolana(expected: ExpectedTransfer): Promise<ChainVerification> {
  const config = getPaymentNetworkConfig("SOLANA");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(expected.transactionHash)) {
    return { status: "FAILED", confirmations: 0, reason: "invalid transaction signature" };
  }
  const solanaRpcUrl = getRpcUrl("SOLANA");
  const genesisHash = await rpc<string>(solanaRpcUrl, "getGenesisHash", []);
  if (genesisHash !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp") {
    throw Object.assign(new Error("Configured RPC endpoint is not Solana mainnet-beta"), { status: 500 });
  }
  const transaction = await rpc<{
    slot?: number;
    meta?: {
      err?: unknown;
      preTokenBalances?: Array<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }>;
      postTokenBalances?: Array<{ accountIndex: number; mint: string; owner?: string; uiTokenAmount: { amount: string } }>;
    } | null;
  } | null>(solanaRpcUrl, "getTransaction", [
    expected.transactionHash,
    { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);
  if (!transaction) return { status: "VERIFYING", confirmations: 0 };
  if (transaction.meta?.err) return { status: "FAILED", confirmations: 1, reason: "transaction failed" };

  const preBalances = new Map(
    (transaction.meta?.preTokenBalances ?? [])
      .filter((balance) => balance.owner === config.receivingAddress && balance.mint === config.tokenIdentifier)
      .map((balance) => [balance.accountIndex, BigInt(balance.uiTokenAmount.amount)])
  );
  const received = (transaction.meta?.postTokenBalances ?? [])
    .filter((balance) => balance.owner === config.receivingAddress && balance.mint === config.tokenIdentifier)
    .reduce((total, balance) => total + BigInt(balance.uiTokenAmount.amount) - (preBalances.get(balance.accountIndex) ?? 0n), 0n);
  if (received < usdtBaseUnits(expected.amount, config.decimals)) {
    return { status: "FAILED", confirmations: 1, reason: "USDT amount, token, or recipient did not match" };
  }
  return { status: "PAID", confirmations: 1 };
}

export async function verifyUsdtTransfer(expected: ExpectedTransfer): Promise<ChainVerification> {
  switch (expected.network) {
    case "BEP20":
    case "CELO":
      return verifyEvm(expected);
    case "TRC20":
      return verifyTron(expected);
    case "SOLANA":
      return verifySolana(expected);
  }
}
