import { query } from "../../db.js";
import { recordVerification } from "../verification/index.js";

interface OnChainTx {
  hash: string;
  chainId: string;
  asset: string; // e.g. "cUSD" or "CELO"
  to: string;
  amount: string; // decimal string, base units already normalized
  confirmations: number;
}

interface ExpectedPayment {
  paymentId: string;
  expectedAsset: string;
  expectedRecipient: string;
  expectedAmount: string;
  minConfirmations: number;
}

// Server-side verification of a CeloHT dApp payment. Never trust a client
// claim of "payment successful" — always re-check the chain data.
export async function verifyCryptoPayment(tx: OnChainTx, expected: ExpectedPayment) {
  const alreadyUsed = await query(
    `SELECT id FROM payment_transactions WHERE tx_hash = $1`,
    [tx.hash]
  );
  if (alreadyUsed.length > 0) {
    await recordVerification(expected.paymentId, "FAILED", "duplicate transaction hash");
    return false;
  }

  const checks = [
    tx.asset === expected.expectedAsset,
    tx.to.toLowerCase() === expected.expectedRecipient.toLowerCase(),
    tx.amount === expected.expectedAmount,
    tx.confirmations >= expected.minConfirmations,
  ];

  if (checks.every(Boolean)) {
    await query(
      `INSERT INTO payment_transactions (payment_id, tx_hash, chain_id, asset, recipient_address, confirmations)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [expected.paymentId, tx.hash, tx.chainId, tx.asset, tx.to, tx.confirmations]
    );
    await recordVerification(expected.paymentId, "PASSED");
    return true;
  }

  await recordVerification(expected.paymentId, "FAILED", "on-chain data did not match expected payment intent");
  return false;
}
