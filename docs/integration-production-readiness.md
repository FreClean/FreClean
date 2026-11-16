# FreClean Integration and Production Readiness Report

Audit date: 2026-11-16

## Executive Status

The repository is a functional Core API foundation with tested authentication, public enquiries, disputes, booking protection, and an in-progress USDT payment API. Local build, tests, lint, repository checks, and clean/legacy migration verification pass. It is not fully production-ready because production database and email delivery have not been reverified, the website/admin UI is outside this repository, a duplicate website contact service remains in the website repository, and payment providers are not configured or independently sandbox-tested.

Last live HTTPS smoke checks, performed on 2026-11-04 (not repeated during this audit):

- `GET https://freclean.onrender.com/health` returned HTTP 200.
- `GET https://freclean.onrender.com/health/ready` returned HTTP 503.
- No production database credentials or secrets were accessed or exposed.

Local validation on 2026-11-16:

- `npm test`: 33 test files passed.
- `npm run build`, `npm run lint`, and `npm run check:repository` passed.
- Migrations 0001-0006 applied and verified on a clean PostgreSQL database.
- Migration 0006 applied and verified on a populated database with an existing enquiry preserved.
- `npm audit --audit-level=high` passed its threshold; six moderate dependency advisories remain.
- GitHub Actions and production services were not run or verified for these uncommitted changes.

## Integration Map

| Component | Owner | Required configuration or credentials | Verification | Status |
|---|---|---|---|---|
| Core API | `FreClean/FreClean` | Render Node.js service, environment variables, PostgreSQL connection | Build, tests, `/health`, `/health/ready`, migrations | Core implemented; production readiness unverified |
| Supabase PostgreSQL | Supabase project | Session Pooler `DATABASE_URL`, TLS/SSL, migration access | Render connect, `SELECT 1`, migration verify, real insert/read-back in non-production first | Live readiness currently 503; credentials unavailable |
| Render | Render | Service repo, build/start commands, health path, environment variables | Render deploy logs and HTTPS endpoints | Service reachable; database unhealthy |
| Customer/staff/admin app | `FreClean/freclean-app` | `VITE_API_URL`; JWT access token handling | Build, login, protected route, admin API smoke test | Public repository exists; only partial UI/API integration verified externally |
| Public website | `FreClean/freclean-website` | `FRECLEAN_PUBLIC_REQUEST_URL`, approved CORS origin | Browser submission with invalid and valid synthetic data | Current script submits to Core, but a separate contact service remains configured in the website repository; deployment status is unverified |
| Contact enquiries | FreClean Core + Resend | `CONTACT_EMAIL=contact@freclean.com`, `RESEND_API_KEY`, verified `RESEND_FROM_EMAIL` | Submit a contact enquiry, confirm durable outbox creation and delivery/retry | Transactional outbox and retry worker implemented; live provider delivery unverified |
| GitHub Actions | `FreClean/.github` or this repository workflow | Repository secrets only where needed | Workflow run status | Organization repository exists; local checks pass, but the latest uncommitted changes have no remote workflow result |
| USDT payments | FreClean Core | `USDT_PAYMENTS_ENABLED`, BSC/TRON/Solana/Celo RPC URLs | Mainnet contract, recipient, amount, success, confirmation/finality and replay checks, followed by ADMIN/OWNER manual confirmation | Four networks are approved; checkout remains disabled until production configuration and operational checks pass |
| CeloHT DApp | Confirmed CeloHT route | `CELOHT_DAPP_URL` | DApp handoff, external receipt review, and ADMIN/OWNER manual confirmation | Separate handoff represented; no automated settlement callback is in this repository |
| Payment notifications | Resend | Existing `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CONTACT_EMAIL` | Customer/admin delivery and outbox retry in a controlled environment | Outbox implemented; production delivery unverified |

## Accessible External Repositories

### FreClean/FreClean

Current repository. Owns database schema, migrations, JWT authentication, RBAC, API business rules, payment state, audit data, and public enquiries.

### FreClean/freclean-app

Publicly accessible React/Vite application. It declares `VITE_API_URL` and uses Core API fetch helpers. It has login/session handling and role-gated routes for customer, staff, and admin areas.

Current visible limitation: admin/staff/customer dashboards are mostly placeholders and do not expose the complete products, bookings, orders, inventory, enquiry, and reporting workflows. These features require implementation in the app repository or this Core API contract, whichever owns the UI interaction.

### FreClean/freclean-website

Publicly accessible static website. It uses `FRECLEAN_PUBLIC_REQUEST_URL` and submits `service`, `property_type`, `space_size`, `date`, `time`, `name`, `phone`, `email`, `location`, `notes`, and `payment_method` to the Core API.

The repository also contains a standalone Node contact service and a Render service definition with its own Resend integration. Its default recipient is `freclean7@gmail.com`, not the required `contact@freclean.com`; it also bypasses the Core enquiry database/outbox. The current website form targets Core, but the separate service's deployment status is unknown. Decommission or remove that duplicate path and verify Render configuration before production use. The website does not own database writes, JWT secrets, payment credentials, or admin functions. Those remain in this Core repository or approved external services.

### FreClean/.github

Publicly accessible organization repository. No reusable secrets should be stored there. It may own organization policies and reusable workflows, but those cannot substitute for Render/Supabase credentials.

## Missing Production Dependencies

### Supabase/PostgreSQL Session Pooler

Why required: authoritative storage, migration execution, readiness, enquiry persistence, authentication records, orders, bookings, inventory, payments, disputes.

Owner configuration: Supabase project database settings and Render environment variables.

Exact environment variable: `DATABASE_URL`.

Required owner action: provide Render with an approved Session Pooler connection string. Do not paste it into chat, GitHub, or source. Verify pool mode, project reference, port, SSL mode, username/database, and connection success using a non-secret diagnostic command.

Safe verification:

1. Set `DATABASE_URL` only in Render's secret environment.
2. Deploy a migration-enabled service.
3. Run `npm run db:verify` from the controlled deployment environment.
4. Call `/health/ready`; require HTTP 200.
5. Apply migrations with the existing migration runner before enabling traffic.

### Render Environment and Service Access

Why required: deployment, process startup, HTTPS termination, environment secrets, health checks, logs.

Owner configuration: Render service dashboard, build command `npm ci && npm run build`, start command `npm start`, health check `/health`, Node.js 20+.

Required secrets: `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ENQUIRY_SPAM_SECRET`, `CORS_ORIGIN=https://freclean.com`.

Owner action: verify service auto-deploy or manual deploy, environment groups, migration execution, log access, and HTTPS DNS/Custom Domain settings.

Safe verification: liveness 200, readiness 200, controlled invalid-origin 403, controlled valid-origin POST 201 only with a non-production database row that is cleaned up according to policy.

### USDT Payment Integration

The Core exposes authenticated payment creation and transaction-hash submission
for FreClean-approved USDT BEP20, TRC20, Solana, and Celo. It retrieves
order/booking prices from the database and checks chain, token, recipient,
amount, transaction success, confirmations/finality, and transaction replay.
A successful chain check leaves the payment awaiting an ADMIN/OWNER's manual
confirmation through `POST /api/payments/:paymentId/confirm`; it does not mark
the payment paid by itself.

Required before enablement: `USDT_PAYMENTS_ENABLED=true`, tested mainnet
`BSC_RPC_URL`, `TRON_RPC_URL`, `SOLANA_RPC_URL`, and `CELO_RPC_URL`. Set
`TRONGRID_API_KEY` only when required by the chosen TRON provider. See
[`payments.md`](payments.md) for the approved networks, configured addresses,
and manual confirmation flow.

USDT checkout remains disabled until RPC providers, receiving-address control,
migrations, and end-to-end payment tests have been confirmed. CeloHT remains a
separate handoff; an administrator must independently check external payment
and manually confirm it. A redirect cannot mark a payment paid.

### Notifications

Why required: reliable delivery of contact enquiries and payment status notifications.

Environment variables: `CONTACT_EMAIL=contact@freclean.com`, `RESEND_API_KEY`,
and `RESEND_FROM_EMAIL` using a verified FreClean sender identity.

Where: Render secret environment. The visitor's email is used as Reply-To;
Resend credentials remain server-side.

Missing: owner-controlled provider credentials, verified sender setup, and
live delivery/retry verification. No second email provider is required.

Safe verification: use an owner-controlled test recipient and inspect outbox
retry state without exposing customer content or provider credentials in logs.

## Safe Improvements Completed in This Repository

- Live external readiness smoke check performed without credentials.
- Public enquiry payload compatibility audited against the website repository.
- Website contact form target confirmed as Core; its separate Resend contact service and wrong default recipient documented as a production blocker.
- USDT payments are disabled by default and require all chain RPCs before production enablement.
- Refresh tokens now require the `refresh` token type.
- Focused configuration and refresh-token tests added.
- Public API contract updated for current website field names and migration 0004.
- Public enquiries and Resend delivery are committed through an outbox with retryable failures.
- Clean migrations 0001-0006 and migration 0006 over a populated legacy database verified locally.

## Prioritized Backlog

### P0: Database and Deployment

1. Restore Supabase connectivity and verify Session Pooler SSL.
2. Verify all migrations, including migrations 0005 and 0006, against the target production database after backup and owner approval.
3. Make Render readiness return 200 only after PostgreSQL success.
4. Apply migrations before traffic.
5. Run controlled synthetic public enquiry insert/read-back.

### P0: Security and Identity

1. Verify refresh-token issuance and rotation policy.
2. Confirm role changes are loaded from database rather than client claims.
3. Provision admin users only through controlled SQL/operations with MFA where available.
4. Complete dependency remediation review for moderate toolchain findings.

### P1: Public and Admin Workflows

1. Add Core list/detail/status audit operations for public enquiries.
2. Implement app screens for bookings, enquiries, orders, inventory, and reports.
3. Add server-side customer record administration and status history.
4. Complete notification provider configuration.

### P1: Payments

1. Verify production RPC providers and receiving-address control for the four approved networks.
2. Verify migrations 0005 and 0006 against clean and production-like existing database copies.
3. Test the CeloHT external handoff and administrator confirmation procedure.
4. Integrate and test website payment UI and product-order APIs in their owning repository.
5. Execute controlled success, mismatch, finality, replay, manual-confirmation, and email delivery tests on all networks.

### P2: Internationalization, SEO, and Operations

1. Implement English, Spanish, French, and Haitian Creole message catalogs.
2. Add exchange-rate configuration only after an approved source and update policy exists.
3. Review sitemap, robots, canonical metadata, legal wording, and public trust claims.
4. Add monitoring and incident/recovery runbooks outside source code.

## Acceptance Status

The project cannot be declared production-ready until:

- `/health/ready` returns 200 for a real verified Supabase/Postgres connection.
- Migrations 0001-0006 are verified in the target database (local clean and legacy copies have passed).
- Production public enquiries can be written and read by authorized staff.
- App and website API bases point to the approved Core API.
- The duplicate website contact service is decommissioned or proven unused, and the Core contact flow delivers to `contact@freclean.com`.
- Admin access is tested with non-production identities.
- USDT payments remain disabled until all network and payment acceptance checks pass.
- CeloHT DApp receipts are independently checked and manually confirmed by an administrator before being treated as paid.
- Notification providers are configured or explicitly reported unavailable.
- Owner approves production deployment and migration execution.
