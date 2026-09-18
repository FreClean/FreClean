# Payment Architecture

FreClean supports exactly three payment categories. Do not add a fourth
without an explicit business-owner decision.

## 1. Crypto — via CeloHT dApp
FreClean never re-implements a wallet UI. Checkout hands off to the CeloHT
dApp; FreClean Core verifies the resulting on-chain transaction server-side
(chain, asset, recipient, amount, confirmations) before marking anything paid.
See `src/payments/crypto/verify.ts`.

## 2. Card — Visa/Mastercard via a certified processor
FreClean never stores raw card data. Checkout uses the processor's
tokenized/hosted flow; FreClean Core only trusts a signature-verified,
idempotent webhook event. See `src/payments/card/webhook.ts`.

## 3. Cash — face-to-face transactions
Only authorized staff can record a cash payment. Every record is reconciled
against the expected amount; discrepancies are flagged, never silently
edited. See `src/payments/cash/record.ts`.

## Unified model
All three write into one `payments` table (method, status, amount,
verification_status, reconciliation_status) so the business has a single
source of truth regardless of execution channel. See `src/payments/model.ts`.

## Rules
- Never mark a payment PAID from client-supplied "success" claims.
- Never auto-switch payment method on failure — the customer must
  explicitly choose another method.
- Every method is idempotent: duplicate tx hashes, duplicate webhook
  events, and duplicate cash submissions are all rejected or ignored.
