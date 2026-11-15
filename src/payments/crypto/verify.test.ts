import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usdtNetworkConfig } from "../config.js";
import { verifyUsdtTransfer } from "./verify.js";

const originalEnvironment = { ...process.env };
const fetchMock = vi.fn();
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

function providerResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function evmResponses(network: "BEP20" | "CELO", values: {
  status?: string;
  token?: string;
  recipient?: string;
  amount?: bigint;
} = {}) {
  const config = usdtNetworkConfig[network];
  const chainId = network === "BEP20" ? "0x38" : "0xa4ec";
  const amount = values.amount ?? (network === "BEP20" ? 1_000_000_000_000_000_000n : 1_000_000n);
  fetchMock
    .mockResolvedValueOnce(providerResponse({ result: chainId }))
    .mockResolvedValueOnce(providerResponse({
      result: {
        status: values.status ?? "0x1",
        blockNumber: "0x64",
        logs: [{
          address: values.token ?? config.tokenIdentifier,
          topics: [
            transferTopic,
            `0x${"0".repeat(24)}1111111111111111111111111111111111111111`,
            `0x${"0".repeat(24)}${(values.recipient ?? config.receivingAddress).slice(2).toLowerCase()}`,
          ],
          data: `0x${amount.toString(16)}`,
        }],
      },
    }))
    .mockResolvedValueOnce(providerResponse({ result: "0x80" }));
}

beforeEach(() => {
  for (const [name, value] of Object.entries({
    BSC_RPC_URL: "https://bsc.example",
    TRON_RPC_URL: "https://tron.example",
    SOLANA_RPC_URL: "https://solana.example",
    CELO_RPC_URL: "https://celo.example",
  })) process.env[name] = value;
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe("USDT chain verification", () => {
  it.each(["BEP20", "CELO"] as const)("verifies USDT transfers on %s using the configured mainnet token", async (network) => {
    evmResponses(network);
    const result = await verifyUsdtTransfer({
      network,
      transactionHash: `0x${"a".repeat(64)}`,
      amount: "1.00",
    });
    expect(result).toEqual({ status: "PAID", confirmations: 29 });
  });

  it("rejects EVM token, recipient, amount, and transaction failures", async () => {
    evmResponses("CELO", { token: `0x${"1".repeat(40)}` });
    await expect(verifyUsdtTransfer({
      network: "CELO",
      transactionHash: `0x${"b".repeat(64)}`,
      amount: "1.00",
    })).resolves.toMatchObject({ status: "FAILED" });

    fetchMock.mockReset();
    evmResponses("CELO", { recipient: `0x${"1".repeat(40)}` });
    await expect(verifyUsdtTransfer({
      network: "CELO",
      transactionHash: `0x${"c".repeat(64)}`,
      amount: "1.00",
    })).resolves.toMatchObject({ status: "FAILED" });

    fetchMock.mockReset();
    evmResponses("CELO", { amount: 999_999n });
    await expect(verifyUsdtTransfer({
      network: "CELO",
      transactionHash: `0x${"d".repeat(64)}`,
      amount: "1.00",
    })).resolves.toMatchObject({ status: "FAILED" });

    fetchMock.mockReset();
    evmResponses("CELO", { status: "0x0" });
    await expect(verifyUsdtTransfer({
      network: "CELO",
      transactionHash: `0x${"e".repeat(64)}`,
      amount: "1.00",
    })).resolves.toMatchObject({ status: "FAILED", reason: "transaction failed" });
  });

  it("requires the selected EVM network and waits for configured confirmations", async () => {
    fetchMock
      .mockResolvedValueOnce(providerResponse({ result: "0x1" }))
      .mockResolvedValueOnce(providerResponse({ result: null }));
    await expect(verifyUsdtTransfer({
      network: "BEP20",
      transactionHash: `0x${"f".repeat(64)}`,
      amount: "1.00",
    })).rejects.toThrow(/not the BNB Smart Chain mainnet/);

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(providerResponse({ result: "0x38" }))
      .mockResolvedValueOnce(providerResponse({
        result: {
          status: "0x1",
          blockNumber: "0x7f",
          logs: [],
        },
      }))
      .mockResolvedValueOnce(providerResponse({ result: "0x80" }));
    await expect(verifyUsdtTransfer({
      network: "BEP20",
      transactionHash: `0x${"1".repeat(64)}`,
      amount: "1.00",
    })).resolves.toEqual({ status: "VERIFYING", confirmations: 2 });
  });

  it("verifies TRC20 finalized transfers against the configured token and recipient", async () => {
    fetchMock
      .mockResolvedValueOnce(providerResponse({
        id: "2".repeat(64),
        blockNumber: 100,
        receipt: { result: "SUCCESS" },
        log: [{
          address: "41a614f803b6fd780986a42c78ec9c7f77e6ded13c",
          topics: [
            transferTopic,
            `0x${"0".repeat(24)}1111111111111111111111111111111111111111`,
            "0x000000000000000000000000b8784fa47f4ef570dd5f40cea8854d16a2a13bdd",
          ],
          data: "f4240",
        }],
      }))
      .mockResolvedValueOnce(providerResponse({ block_header: { raw_data: { number: 120 } } }));
    await expect(verifyUsdtTransfer({
      network: "TRC20",
      transactionHash: "2".repeat(64),
      amount: "1.00",
    })).resolves.toEqual({ status: "PAID", confirmations: 21 });
  });

  it("rejects TRC20 transfers from another contract", async () => {
    fetchMock
      .mockResolvedValueOnce(providerResponse({
        id: "3".repeat(64),
        blockNumber: 100,
        receipt: { result: "SUCCESS" },
        log: [{
          address: "41" + "1".repeat(40),
          topics: [
            transferTopic,
            `0x${"0".repeat(24)}1111111111111111111111111111111111111111`,
            "0x000000000000000000000000b8784fa47f4ef570dd5f40cea8854d16a2a13bdd",
          ],
          data: "f4240",
        }],
      }))
      .mockResolvedValueOnce(providerResponse({ block_header: { raw_data: { number: 120 } } }));
    await expect(verifyUsdtTransfer({
      network: "TRC20",
      transactionHash: "3".repeat(64),
      amount: "1.00",
    })).resolves.toMatchObject({ status: "FAILED" });
  });

  it("verifies finalized Solana token-account balance deltas for the USDT mint", async () => {
    fetchMock
      .mockResolvedValueOnce(providerResponse({ result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }))
      .mockResolvedValueOnce(providerResponse({
        result: {
          slot: 900,
          meta: {
            err: null,
            preTokenBalances: [],
            postTokenBalances: [{
              accountIndex: 2,
              mint: usdtNetworkConfig.SOLANA.tokenIdentifier,
              owner: usdtNetworkConfig.SOLANA.receivingAddress,
              uiTokenAmount: { amount: "1000000" },
            }],
          },
        },
      }));
    await expect(verifyUsdtTransfer({
      network: "SOLANA",
      transactionHash: "5".repeat(88),
      amount: "1.00",
    })).resolves.toEqual({ status: "PAID", confirmations: 1 });
  });

  it("rejects an incorrect Solana token mint and failed transaction", async () => {
    fetchMock
      .mockResolvedValueOnce(providerResponse({ result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }))
      .mockResolvedValueOnce(providerResponse({
        result: {
          slot: 900,
          meta: {
            err: null,
            preTokenBalances: [],
            postTokenBalances: [{
              accountIndex: 2,
              mint: "NotTheUSDTMint",
              owner: usdtNetworkConfig.SOLANA.receivingAddress,
              uiTokenAmount: { amount: "1000000" },
            }],
          },
        },
      }));
    await expect(verifyUsdtTransfer({
      network: "SOLANA",
      transactionHash: "6".repeat(88),
      amount: "1.00",
    })).resolves.toMatchObject({ status: "FAILED" });

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce(providerResponse({ result: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp" }))
      .mockResolvedValueOnce(providerResponse({
        result: {
          slot: 900,
          meta: {
            err: { InstructionError: [0, "Custom"] },
            preTokenBalances: [],
            postTokenBalances: [],
          },
        },
      }));
    await expect(verifyUsdtTransfer({
      network: "SOLANA",
      transactionHash: "7".repeat(88),
      amount: "1.00",
    })).resolves.toMatchObject({ status: "FAILED", reason: "transaction failed" });
  });
});
