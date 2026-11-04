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

The supported methods are `CRYPTO`, `CARD`, and `CASH`. Crypto assets are `CELO` and `USDm`. Payment status is read-only client data: only server-side chain verification, processor-signed webhook handling, or authorized cash reconciliation can change it. Payment mutations require idempotency keys or provider event identifiers where applicable.

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
  "payment_method": "Cash",
  "message": "I would like a cleaning estimate for my home.",
  "website": ""
}
```

For compatibility, either `fullName` or `name` is required, and either `message` or `notes` is required. The website may submit `notes` alone. All submitted known fields are persisted. `type` is exactly `SERVICE` or `CONTACT` and defaults to `SERVICE`. Names are 2-100 characters, email is 254 characters or fewer, phone is optional with 32 characters or fewer, service/property/location values use bounded text validation, date is an ISO date, and time is 24-hour `HH:MM`. Notes or message text is 10-5000 characters. Unknown fields are rejected. The optional empty honeypot field `website` may be included by the website client. The request body is limited to 16 KB, and the route allows 10 submissions per source address per 15 minutes.

Success:

```http
HTTP/1.1 201 Created
Content-Type: application/json

{"received":true,"requestId":"9f1d3f6f-7ab8-44aa-b23f-0a8d0e0c9ad1"}
```

The `requestId` is returned only after the PostgreSQL insert commits and Resend accepts delivery to the FreClean inbox. Validation failures return `400` with field errors, duplicate submissions return `409`, body-limit violations return `413`, origin violations return `403`, rate-limit violations return `429`, Resend failures return `502`, and database or server failures return `500` with a generic error body. PII is not included in receipt or error responses.

In production, CORS is restricted to the exact origin `https://freclean.com`. The production deployment must set `CORS_ORIGIN=https://freclean.com`, `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, a random 32-character-or-longer `ENQUIRY_SPAM_SECRET`, `RESEND_API_KEY`, and a verified `RESEND_FROM_EMAIL`. Resend credentials remain server-only; enquiries are sent to `freclean7@gmail.com`. Card credentials are required only when `CARD_PAYMENTS_ENABLED=true`; crypto configuration is required only when `CRYPTO_PAYMENTS_ENABLED=true`. Disabled payment integrations remain unavailable and fail closed.

Apply migrations `database/migrations/0003_public-enquiries.sql` and `database/migrations/0004_public-enquiry-fields.sql` before starting the API. Migration 0004 is additive and does not delete existing public enquiry rows. Deployments must terminate TLS at the public HTTPS edge, expose `/health` and `/health/ready`, and run a real HTTPS smoke test before reporting the endpoint deployed. The Render core service is `https://freclean.onrender.com`; configure its Render Health Check Path as `/health`.

## Environment and deployment

Runtime configuration is supplied through environment variables documented in `.env.example`. Secrets, database credentials, processor credentials, and wallet keys are never committed. Deployments apply migrations before starting the API, expose `/health` for liveness and `/health/ready` for database readiness, and support graceful `SIGTERM` shutdown. Readiness performs only `SELECT 1`, reports no connection details, and returns 503 on failure. The public website origin is `https://freclean.com`; no Supabase integration or Stripe implementation is part of the current backend, and payment endpoints must remain disabled until their provider configuration and verification are properly implemented.

## Release process

1. Run build, lint, tests, migration validation, and security checks.
2. Merge only when required checks pass.
3. Deploy the core API and migrations first when a contract or schema change requires it.
4. Deploy app and website clients compatible with the released API.
5. Run readiness and smoke checks, then monitor structured logs and audit records.

The other repositories must adopt this contract in their own README and CI configuration before a cross-repository release is considered complete.
