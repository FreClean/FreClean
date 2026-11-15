# FreClean API Contract

## Ownership

- `FreClean/FreClean` owns the `/api` contract, business rules, PostgreSQL schema, migrations, authentication, authorization, and payment state.
- `FreClean/freclean-app` is a client of the API for customer, staff, manager, admin, and owner workflows. It must not write PostgreSQL or reimplement business rules.
- `FreClean/freclean-website` is a public client. It may use approved public API endpoints and must not access PostgreSQL.
- `FreClean/.github` owns organization-wide CI/CD workflows, security policies, templates, and reusable automation.

## API and compatibility

The current API is under `/api`. JSON request and response shapes are versioned through additive, backward-compatible changes. Breaking changes require a new version prefix, migration notes, and coordinated releases of the app and website. Clients must not infer business state from local calculations.

Every protected request uses `Authorization: Bearer <access-token>`. The API is the only authority for identity, roles, service/product data, booking state, order state, and payment state.

## Disputes contract

The dispute API is authoritative for complaint ownership, status, communication
visibility, and audit history. Clients must use the canonical codes exported by
`src/disputes/model.ts`; they must not invent alternate status or category names.

- `POST /api/disputes`: create a customer-owned case. The customer is taken from the access token.
- `GET /api/disputes`: list cases visible to the authenticated customer, assigned staff member, or authorized queue role.
- `GET /api/disputes/:id`: retrieve an authorized case and its permitted messages.
- `POST /api/disputes/:id/messages`: add a customer-visible message; internal messages require investigation permission.
- `POST /api/disputes/:id/transition`: apply one allowed state transition using the current status for concurrency protection.

Dispute public references are identifiers only, not authorization credentials.
The API does not claim evidence uploads or refunds succeeded until private storage
and the authoritative refund domain are integrated.

## Payment contract

The only new payment methods are `USDT` and `CELOHT_DAPP`. USDT networks are `BEP20`, `TRC20`, `SOLANA`, and `CELO`; the network, token, amount, and receiving address are selected or calculated server-side from the payment intent. CeloHT remains a separate DApp handoff. Payment statuses are `PENDING`, `VERIFYING`, `PAID`, `FAILED`, `EXPIRED`, `CANCELLED`, or `REFUNDED`; a customer-provided transaction hash never marks a payment paid.

- `POST /api/payments`: authenticated customer creates an order- or booking-linked payment. Requires an `Idempotency-Key` header and exactly one of `orderId` or `bookingId`. Body fields are `paymentMethod` (`USDT` or `CELOHT_DAPP`) and, for USDT, `network`. The server retrieves the amount from the owned order/booking.
- `POST /api/payments/:paymentId/transaction`: authenticated owner submits only `transactionHash` for a USDT payment. The API independently verifies the selected mainnet token, recipient, amount, success, and confirmations.
- `GET /api/payments/:paymentId`: retrieves the authenticated customer's payment.
- `GET /api/payments/admin`: ADMIN-only payment list with customer, order/booking, amount, asset, network, recipient, transaction, status, and verification date.

The customer should display the selected network and its configured receiving address and warn: “Send USDT only through the selected network. Sending funds through another network may result in permanent loss of funds.” Payment verification and notification behavior is documented in [`payments.md`](payments.md). Existing pre-migration payment rows are retained; the legacy schema migration is not rewritten.

## Public website enquiries

`POST /api/public/requests` accepts anonymous service and contact enquiries from `https://freclean.com`. The endpoint requires no bearer token and must not be used to create bookings, orders, payments, or approval state.

Request JSON accepts legacy contact fields and the current website booking fields:

```json
{
  "type": "SERVICE",
  "fullName": "Jean Pierre",
  "name": "Jean Pierre",
  "email": "visitor@example.com",
  "phone": "+509 1234 5678",
  "service": "Residential cleaning",
  "property_type": "Apartment",
  "space_size": "Medium",
  "date": "2026-12-15",
  "time": "14:30",
  "location": "Santo Domingo",
  "notes": "Please include kitchen and balcony cleaning.",
  "payment_method": "USDT TRC20",
  "message": "I would like a cleaning estimate for my home.",
  "website": ""
}
```

For compatibility, either `fullName` or `name` is required, and either `message` or `notes` is required. The website may submit `notes` alone. All submitted known fields are persisted. `type` is exactly `SERVICE` or `CONTACT` and defaults to `SERVICE`. Names are 2-100 characters, email is 254 characters or fewer, phone is optional with 32 characters or fewer, service/property/location values use bounded text validation, date is an ISO date, and time is 24-hour `HH:MM`. Notes or message text is 10-5000 characters. Unknown fields are rejected. The optional empty honeypot field `website` may be included by the website client. The request body is limited to 16 KB, and the route allows 10 submissions per source address per 15 minutes.

Success:

```http
HTTP/1.1 201 Created
Content-Type: application/json

{"received":true,"requestId":"9f1d3f6f-7ab8-44aa-b23f-0a8d0e0c9ad1","message":"Your message has been received. The FreClean team will respond as soon as possible."}
```

The enquiry and its notification are committed together to PostgreSQL. A background worker sends the notification through the existing Resend integration to `contact@freclean.com`; it uses the visitor's email as Reply-To and retries provider failures with backoff. The API success response means the enquiry is durably queued, not that Resend has already delivered it. Operational failures return `503` with the customer-safe message “Your message could not be sent right now. Please try again later.”; provider details are logged server-side only. Validation failures return `400` with field errors, duplicate submissions return `409`, body-limit violations return `413`, origin violations return `403`, and rate-limit violations return `429`. PII is not included in error responses.

In production, CORS is restricted to the exact origin `https://freclean.com`. The production deployment must set `CORS_ORIGIN=https://freclean.com`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, a random 32-character-or-longer `ENQUIRY_SPAM_SECRET`, `CONTACT_EMAIL=contact@freclean.com`, `RESEND_API_KEY`, and a verified `RESEND_FROM_EMAIL`. Resend credentials remain server-only. USDT payments stay disabled unless `USDT_PAYMENTS_ENABLED=true` and all four mainnet RPC URLs are configured. The separate CeloHT option requires `CELOHT_DAPP_URL`; it remains pending until an authoritative settlement integration is implemented.

Apply all migrations with `npm run db:migrate` before starting the API. Migration 0004 adds public-enquiry fields; migration 0005 adds crypto payment fields, order/booking payment state, replay protection, and payment notification outbox tables; migration 0006 adds the public-enquiry email outbox. These migrations preserve existing payment and enquiry records. Deployments must terminate TLS at the public HTTPS edge, expose `/health` and `/health/ready`, and run a real HTTPS smoke test before reporting the endpoint deployed. The Render core service is `https://freclean.onrender.com`; configure its Render Health Check Path as `/health`.

## Environment and deployment

Runtime configuration is supplied through environment variables documented in `.env.example`. Secrets, database credentials, blockchain provider credentials, and wallet keys are never committed. Deployments apply migrations before starting the API, expose `/health` for liveness and `/health/ready` for database readiness, and support graceful `SIGTERM` shutdown. Readiness performs only `SELECT 1`, reports no connection details, and returns 503 on failure. The public website origin is `https://freclean.com`; USDT checkout remains disabled until provider configuration and mainnet verification are validated.

## Release process

1. Run build, lint, tests, migration validation, and security checks.
2. Merge only when required checks pass.
3. Deploy the core API and migrations first when a contract or schema change requires it.
4. Deploy app and website clients compatible with the released API.
5. Run readiness and smoke checks, then monitor structured logs and audit records.

The other repositories must adopt this contract in their own README and CI configuration before a cross-repository release is considered complete.
