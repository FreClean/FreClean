# Payment Architecture

## Supported customer payment methods

FreClean accepts only these payment methods:

1. USDT on the FreClean-approved BNB Smart Chain (BEP20), TRON (TRC20),
   Solana, or Celo network.
2. CeloHT DApp as a separate payment route, not USDT.
3. Cash in person at authorized FreClean physical points of sale only.

Cash is never an online or remote option. No card-network payment method is
accepted. The API supports the two digital routes; cash is handled in person at
authorized physical points of sale, not through this API. Historical payment
rows and the original `0001_init.sql` migration are retained for data
integrity; new API requests accept only `USDT` and `CELOHT_DAPP`.

## Core flow and API

- `POST /api/payments` creates a payment for exactly one customer-owned order
  or booking. It requires an `Idempotency-Key`; price and currency are loaded
  from PostgreSQL, never accepted from the client. USDT is quoted one-to-one
  from the USD order/booking total.
- The response includes the selected network name, the server-configured
  receiving address, the USDT token identifier, and the warning:
  “Send USDT only through the selected network. Sending funds through another
  network may result in permanent loss of funds.”
- `POST /api/payments/:paymentId/transaction` accepts only a transaction hash.
  The backend loads the asset, network, recipient, and amount from the saved
  payment, then queries that network's configured mainnet provider.
- `GET /api/payments/:paymentId` returns only the authenticated customer's
  payment. `GET /api/payments/admin` requires the ADMIN role and lists payment,
  customer, order/booking, amount, asset, network, address, transaction,
  status, and verification date.
- A submitted USDT transaction is checked server-side for the selected network,
  token, recipient, amount, and finality. A successful check leaves the payment
  in `VERIFYING`; it is not confirmation of payment. An ADMIN or OWNER must
  manually confirm it through `POST /api/payments/:paymentId/confirm` with a
  recorded confirmation note before the payment becomes `PAID`. Provider
  failures do not produce a success response. A transaction hash is reserved
  with a unique database index to prevent replay.
- The payment, order/booking payment state, audit record, and customer/admin
  notification outbox entries are committed in one database transaction.
  Email delivery is retried from the outbox and uses provider idempotency keys.

## Receiving addresses and token identifiers

Addresses are centralized in `src/payments/config.ts`; do not copy them into
client bundles or duplicate them in other server modules.

| Asset/network | Receiving address | Token identifier |
|---|---|---|
| USDT BEP20 | `0xcbe30a91dbc6a2423c30d8c8dd0547b8dcb0e044` | `0x55d398326f99059ff775485246999027b3197955` |
| USDT TRC20 | `TSnbTib4DAEpGbesxUzjN2pgtcJigs8veR` | `TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t` |
| USDT Solana | `33FM1eKWBNWfA6qDf1EFZ8Ab6U6RiXhJkG6NyFL1wTYf` | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |
| USDT Celo | `0xcbe30a91dbc6a2423c30d8c8dd0547b8dcb0e044` | `0x48065fbbe25f71c9282ddf5e1cd6d6a887483d5e` |

FreClean has approved these four networks. Keep
`USDT_PAYMENTS_ENABLED=false` until production RPC configuration, receiving
address ownership checks, and operational payment tests are complete.

## Network verification

The verifier accepts no user-supplied token, recipient, chain ID, amount, or
confirmation count.

- **BEP20:** checks BNB Smart Chain chain ID, receipt success, matching USDT
  `Transfer` logs, exact configured recipient, sufficient token base units,
  and at least 12 confirmations. It also checks the Celo RPC for a hash found
  on the other EVM network.
- **TRC20:** queries a TRON solidified transaction-info endpoint, requires
  `SUCCESS`, checks the USDT contract and recipient in the transfer logs, and
  waits for at least 20 block confirmations.
- **Solana:** checks the mainnet-beta genesis hash, obtains the transaction at
  `finalized` commitment, rejects failed transactions, and verifies the
  recipient's token-account balance delta for the configured USDT mint.
- **Celo:** checks chain ID, receipt success, matching USDT `Transfer` logs,
  exact recipient, sufficient token base units, and at least 3 confirmations.

The amount is converted to base units using network token precision (18
decimals for the configured BNB contract; 6 for TRON, Solana, and Celo).
Provider responses are bounded by a 10-second timeout. Provider credentials
and URLs remain server-side.

## CeloHT DApp

CeloHT is a separate, FreClean-confirmed `CELOHT_DAPP` payment route. Its
handoff URL is supplied through `CELOHT_DAPP_URL`; it is never represented as
USDT. The Core repository contains no DApp settlement callback or verifiable
CeloHT transaction adapter. An authorized administrator must check the
external payment independently and manually confirm it with a recorded note.
A DApp redirect or customer-submitted hash is not confirmation.

## Statuses, administration, and notifications

Current statuses are `PENDING`, `VERIFYING`, `PAID`, `FAILED`, `EXPIRED`,
`CANCELLED`, and `REFUNDED`. Only an authorized administrator's explicit
confirmation marks an eligible payment as `PAID`. USDT must first pass the
server-side chain checks; CeloHT must first be independently checked outside
the Core API. The confirmation note and administrator identity are recorded in
the audit log. Admin access is authenticated and role-gated; transaction
explorer URLs are derived from the payment's persisted network.

After an administrator confirms payment, a transactional outbox queues a
customer receipt and an admin notice. USDT receipts include the network and
transaction hash; CeloHT receipts identify the separate route. The
notification workers retry transient delivery failures up to five times with
increasing delays, persist safe error codes, and use stable Resend idempotency
keys. Resend credentials stay in the server environment; malformed or missing
production configuration prevents startup.

## Environment and production deployment

Required in production for the Core API:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (32+ characters)
- `ENQUIRY_SPAM_SECRET` (32+ characters)
- `CORS_ORIGIN=https://freclean.com`
- `CONTACT_EMAIL=contact@freclean.com`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`

Required before setting `USDT_PAYMENTS_ENABLED=true`:

- `BSC_RPC_URL`
- `TRON_RPC_URL`
- `SOLANA_RPC_URL`
- `CELO_RPC_URL`
- `TRONGRID_API_KEY` when required by the selected TRON provider
- `CELOHT_DAPP_URL` to expose the separate CeloHT option

RPC endpoints must be HTTPS in production and point to the intended mainnets.
Never put private keys, seed phrases, or signing credentials in source,
frontend configuration, logs, or GitHub.

Apply migrations before starting the API:

```bash
npm ci
npm run build
npm run db:migrate
npm run db:verify
npm test
npm start
```

`0005_crypto-payments.sql` is additive and retains existing payment history.
`0007_notification-retry-safety.sql` adds the payment outbox retry timestamp.
`0008_disable-card-payment-inserts.sql` prevents new legacy card or generic
crypto payment rows while preserving existing history and the in-person cash
route. Apply all migrations before deploying the API.
Test it against both an empty schema and a copy of the current production
schema before deployment. The API repository has no website checkout, product
order-creation API, admin dashboard UI, or CeloHT settlement integration.
Those are separate release dependencies; this repository's API foundation
does not make the complete customer payment journey production-ready.

## Admin troubleshooting

- `PENDING`: no transaction hash has been submitted.
- `VERIFYING`: the transaction is not yet visible/finalized or has not reached
  its confirmation threshold; retry the same hash after confirmation.
- `FAILED`: inspect the network-specific explorer link, token contract/mint,
  recipient, amount, transaction status, and selected network.
- Missing/invalid RPC configuration is a service error and never confirms a
  payment.
- Review notification delivery through `payment_notification_outbox`; retry
  state and attempts are recorded without storing provider credentials.

## Production acceptance checklist

- [ ] Apply migration 0005 to a clean database and a production-like existing
      database copy; verify existing payment rows remain unchanged.
- [ ] Apply migration 0008 and verify it rejects new legacy payment methods
      without changing existing payment history or the cash-at-point-of-sale route.
- [ ] Verify all four receiving addresses and mainnet RPC endpoints.
- [ ] Run success, wrong-network, wrong-token, wrong-recipient, underpayment,
      failed-transaction, and duplicate-hash tests for every chain.
- [ ] Test customer-owned order/booking payment creation and status updates.
- [ ] Test the administrator-only manual confirmation flow for verified USDT
      and independently checked CeloHT payments.
- [ ] Test customer/admin email delivery and outbox retry behavior.
- [ ] Integrate and test the website checkout and admin interface in their own
      repositories.
- [ ] Keep USDT checkout disabled until the above checks pass.
