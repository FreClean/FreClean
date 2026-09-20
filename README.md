# FreClean Core
<img width="1672" height="941" alt="file_000000006e6481f5ad01e503c55c2326" src="https://github.com/user-attachments/assets/7e646cb0-b2b3-4cd2-b0db-3412f734ec33" />


Backend / API / Database / Business Logic for the FreClean ecosystem
(cleaning services, products, bookings, orders, inventory, payments, disputes, entrepreneurship).

This is the **canonical core repository**. It owns all business rules and is the
only service allowed to write to the production database.

## Stack

- Node.js 20+ / TypeScript
- Express
- PostgreSQL (raw SQL migrations, `pg` driver no hidden ORM magic)
- JWT-based auth, RBAC middleware
- Vitest for tests

## Getting started

```bash
cp .env.example .env
npm install
npm run db:migrate
npm run dev
```

## Structure

```
src/
  auth/            registration and login
  bookings/        booking lifecycle
  disputes/        complaints, case workflow, communication, and audit integration
  roles/            authorization and RBAC
  payments/
    crypto/        CELO and USDm verification (server-side only)
    card/          processor webhook verification
    cash/          staff-recorded cash payments + reconciliation
    verification/  shared fail-closed verification logic
database/migrations/   versioned SQL migrations
scripts/               operational scripts
docs/                  architecture and payment/security documentation
```

## Payment policy

FreClean supports exactly three payment categories see `docs/payments.md`:

1. **Crypto** - CELO and USDm, verified against server-side chain data
2. **Card** - via a certified payment processor (Visa/Mastercard), tokenized, webhook-verified
3. **Cash** - recorded by authorized staff only, reconciled centrally

All three write into one unified `payments` domain model (`src/payments/model.ts`).
No payment is ever marked `PAID` from client-supplied data — verification is
always server-side and fail-closed.

## Disputes and complaints

The canonical dispute API is under `/api/disputes`. It supports authenticated
case creation, ownership-filtered retrieval, explicit dispute permissions,
controlled status transitions, customer/internal communication visibility, and
audit history. See [`docs/disputes.md`](docs/disputes.md) for the contract and
the boundaries that still require external infrastructure, including private
evidence storage and refund-provider integration.

## Security

- Server-side authorization only never trust frontend role claims.
- Secrets live in environment variables, never in git. See `.env.example`.
- Production configuration is validated before startup; missing required secrets or invalid payment config fail the process.
- Refresh tokens are issued for secure session renewal and the core API refuses invalid refresh tokens.
- See `docs/security.md` for the full checklist this repo is audited against.

## Production readiness notes

This repository is the authoritative core of the FREClean architecture. It enforces the business rules, writes to PostgreSQL, verifies payment state, and is the only service allowed to issue authoritative payment/order state.

External dependencies still required for a full regulated deployment include
private evidence storage and malware scanning, refund and notification providers,
the customer/staff frontend repositories, payment processor approval, legal
review for jurisdictional compliance, tax registration review, product
compliance review, and a formal security audit before production go-live.

## License

MIT - see LICENSE.
