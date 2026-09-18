# FreClean — Core

Backend / API / Database / Business Logic for the FreClean ecosystem
(cleaning services, products, bookings, orders, inventory, payments, entrepreneurship).

This is the **canonical core repository**. It owns all business rules and is the
only service allowed to write to the production database.

## Stack

- Node.js 20+ / TypeScript
- Express
- PostgreSQL (raw SQL migrations, `pg` driver — no hidden ORM magic)
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
  auth/            registration, login, sessions, password recovery
  users/ customers/ staff/ roles/ permissions/
  services/ bookings/        cleaning-service catalog + booking lifecycle
  products/ inventory/ carts/ orders/
  payments/
    crypto/        CeloHT dApp verification (server-side only)
    card/          processor webhook verification
    cash/          staff-recorded cash payments + reconciliation
    verification/  shared fail-closed verification logic
    reconciliation/
  notifications/ entrepreneurship/ support/ analytics/ audit/ integrations/ web3/
database/migrations/   versioned SQL migrations
tests/                 unit + integration tests
docs/                  architecture, ADRs, API reference
```

## Payment policy

FreClean supports exactly three payment categories — see `docs/payments.md`:

1. **Crypto** — via the CeloHT dApp (FreClean never re-implements a wallet UI)
2. **Card** — via a certified payment processor (Visa/Mastercard), tokenized, webhook-verified
3. **Cash** — recorded by authorized staff only, reconciled centrally

All three write into one unified `payments` domain model (`src/payments/model.ts`).
No payment is ever marked `PAID` from client-supplied data — verification is
always server-side and fail-closed.

## Security

- Server-side authorization only — never trust frontend role claims.
- Secrets live in environment variables, never in git. See `.env.example`.
- See `docs/security.md` for the full checklist this repo is audited against.

## License

MIT — see LICENSE.
