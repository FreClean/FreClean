# Production Integration Audit

Audit date: 2026-11-04

## Scope

This audit covers the FreClean core repository and read-only production smoke checks against `https://freclean.onrender.com`. It does not inspect or modify the separate website repository. No credentials were read from or written into this audit.

## Public API Routes

- `GET /health` - liveness probe.
- `GET /health/ready` - PostgreSQL readiness probe using `SELECT 1`.
- `POST /api/auth/register` - customer registration.
- `POST /api/auth/login` - email/password login.
- `POST /api/auth/refresh` - refresh access-token generation.
- `POST /api/bookings/` - authenticated booking creation.
- `POST /api/public/requests` - anonymous public enquiry submission.
- `POST /api/payments/cash` - authenticated staff cash-payment recording.
- `POST /api/payments/card/webhook` - signature webhook for the generic card processor.
- `POST /api/disputes` - authenticated dispute creation.
- `GET /api/disputes` - authorized dispute listing.
- `GET /api/disputes/:id` - authorized dispute retrieval.
- `POST /api/disputes/:id/transition` - staff investigation transition.
- `POST /api/disputes/:id/messages` - dispute message creation.

## Verified Functionality

### HTTP and deployment

- `/health` returned HTTP 200 with `{"status":"ok"}` from the Render service during production smoke testing.
- `/health/ready` is implemented as a fail-closed `SELECT 1` check and returns 503 with a generic database status on failure.
- A live HTTPS smoke check on 2026-11-04 returned HTTP 200 from `/health` and HTTP 503 from `/health/ready`; this confirms liveness but not database readiness or successful production persistence.
- The production readiness smoke check previously returned HTTP 503. This proves the endpoint detected an unavailable database at that time, but it does not prove subsequent recovery.
- A fresh readiness smoke check timed out at the client's 20-second limit. The readiness implementation now limits the database check itself to five seconds and returns HTTP 503 instead of hanging.
- `/` now returns HTTP 200 with `{"status":"ok"}`; it is a minimal service liveness signal, not an API inventory or internal status page.

### CORS and public enquiries

- Production CORS allows the exact origin `https://freclean.com`.
- Other origins are rejected by the CORS middleware.
- `POST /api/public/requests` accepts only the documented request schema and rejects unknown fields.
- An empty production public enquiry request returned HTTP 400 with field validation details.
- Public enquiry validation normalizes email, validates phone/service/message lengths, rejects a non-empty honeypot field, and limits the JSON body to 64 KB globally with a route-specific 16 KB limit in middleware.
- IP-based rate limiting and a per-email/name/message spam hash are implemented.
- The public route records the approved source origin and saves only the approved origin value.

### Authentication and authorization

- JWT middleware rejects missing credentials and invalid signed tokens.
- The integration test confirms signed customer tokens attach only middleware-derived `sub` identity and a validated role list.
- Protected booking and cash routes reject unauthenticated requests.
- This repository implements custom JWT authentication using `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`; it has no Supabase dependency.

### Payments

- Card webhook processing now requires `CARD_PAYMENTS_ENABLED=true` and returns HTTP 503 when disabled.
- Cash recording requires authentication and the `STAFF` role.
- Card webhook signatures are verified with a timing-safe HMAC comparison when enabled.
- No Stripe SDK, Stripe secret, Stripe webhook route, or Stripe payment implementation exists.
- Client payment success claims are not authoritative; payment state remains server-verified by the existing domain paths.

### Error handling

- Zod validation errors return HTTP 400 with field errors.
- Oversized request handling returns HTTP 413.
- Disallowed origins return HTTP 403.
- Database/server failures return a generic HTTP 500 response.
- Readiness database failures return generic HTTP 503 data without connection strings, hosts, or credentials.
- Pino structured request logging is enabled; expected validation and readiness failures remain logged without response credential disclosure.

## PostgreSQL and Migration Verification

### Root cause and code changes

- Before the fix, the `pg` pool had no connection, query, statement, or idle timeout.
- The readiness handler could therefore wait on an unbounded pool connection attempt, and prior smoke checks waited until the HTTP client timed out.
- The readiness handler now races `SELECT 1` against a five-second timeout, while `src/db.ts` sets a five-second connection timeout, five-second query/statement timeout, and a 30-second idle timeout.
- Supabase/Postgres pooler hostnames now receive explicit TLS configuration when `sslmode` is not already present in `DATABASE_URL`; existing `sslmode` settings remain authoritative, and certificate verification remains enabled.
- The migration runner and migration verifier use the same five-second connection/query bounds and hosted PostgreSQL TLS behavior.
- Readiness failures log only a database error code category or timeout label, never the connection string, host, username, or response PII.

### Local verification

- The repository originally returned 404 from `/` because no root route was registered; a minimal root handler now returns `{"status":"ok"}`.
- Docker PostgreSQL 16 started from the repository Compose configuration.
- `npm run db:migrate` applied `0001_init.sql`, `0002_disputes.sql`, and `0003_public-enquiries.sql` successfully.
- `npm run db:verify` can report applied migrations, pending migrations, required table presence, and enquiry indexes.
- Direct local verification found the four required enquiry structures: `public_enquiries_pkey`, `idx_public_enquiries_created`, `idx_public_enquiries_status_created`, and `idx_public_enquiries_recent_spam_hash`.
- A real parameterized insert was executed inside a transaction and read back by its UUID; the transaction then rolled back. The cleanup left zero audit test rows (`integration-audit-only`).

This is real local PostgreSQL write/read-back verification, not production persistence verification.

### Production connectivity result

- The latest deployed liveness check returns HTTP 200.
- The latest deployed readiness check returns HTTP 503 with `{"status":"unavailable","database":"unavailable"}` instead of hanging.
- Production PostgreSQL connectivity remains unverified as successful.
- Production migration state remains unverified because the Render credential environment cannot be accessed safely from this workspace.
- The report does not claim a Supabase-compatible `DATABASE_URL` until the Render hostname, pool mode, SSL mode, and actual query success are verified from the deployment environment.

## Unverified Functionality

The following could not be confirmed without exposing or obtaining production credentials and without creating production data:

- Actual production PostgreSQL persistence for public enquiries or bookings.
- Migration state in the Render production database.
- Successful production login, registration, refresh-token, or dispute workflow.
- Production Supabase authentication because there is no Supabase integration in this backend.
- Successful enabled-card webhook processing against a real processor.
- Successful authenticated production customer workflow against real PostgreSQL data.

During the audit, one live readiness check returned 503 and another timed out at the client limit. The implementation now returns bounded 503 readiness responses; database persistence must still not be represented as verified successful.

## Automated Integration Coverage Added

- Liveness and readiness responses.
- Unauthenticated booking and cash routes.
- Invalid and signed JWT behavior.
- Card webhook disabled-by-default fail closed behavior.
- Approved and disallowed public enquiry origins.

Existing suites also cover public enquiry validation/persistence contracts, CORS, CORS origin behavior, rate limiting, HMAC signatures, RBAC, and JWT middleware.

## Frontend Integration Requirements

The frontend must:

1. Set the API base URL to `https://freclean.onrender.com` for backend calls.
2. Use `https://freclean.com` exactly as the browser origin.
3. Send public enquiry fields with the existing documented names and include JSON content type.
4. Do not include PII in URLs or logs.
5. Send access tokens as `Authorization: Bearer <token>`.
6. Store and rotate refresh tokens according to secure frontend session rules; never expose JWT signing secrets.
7. Handle HTTP 400, 401, 403, 409, 413, 429, 500, and readiness HTTP 503 responses.
8. Submit booking identities only as server-issued UUID references; never infer customer identity or authorization from the browser.
9. Treat payment success as server-authoritative only. Do not add Stripe checkout until Stripe configuration, webhook verification, and provider enablement are implemented and approved.
10. Do not attempt direct Supabase database access; this backend owns PostgreSQL and does not expose Supabase authentication sessions.

## npm Vulnerability Audit

The full audit reports 17 findings: 13 moderate and 4 high; there are no critical findings.

- `body-parser <1.20.9`: high. Installed `1.20.8`; fix is `1.20.9` through the normal npm audit remediation path. Exploitable only where compressed request bodies reach the parser with malformed trailing bytes; application input limits reduce exposure.
- `qs 6.7.0 - 6.16.0`: moderate. Installed `6.16.0`; fix is `6.16.2` via normal audit remediation.
- `vite 8.3.0 - 8.3.2`: high. Installed `8.3.0`; fix is `8.3.5` via normal audit remediation. These findings primarily affect development-server source/file behavior and Windows editor launches, not the built production server.
- `vitest 5.0.0-beta.1 - 5.0.2` and transitive `@vitest/mocker`: moderate; installed Vitest `5.0.1`. Fix preview updates Vitest to `5.1.0` through normal audit remediation.
- `source-map-js 1.0.0 - 1.2.1`: high; fix preview updates it to `1.2.2`.
- `zod <4.6.6`: high. Installed `3.25.76`; npm proposes `zod 4.6.7`, a major breaking upgrade. Do not apply with `npm audit fix --force`; assess API migration compatibility before any major upgrade.
- `minimatch <11.0.1`: moderate and transitive through ESLint tooling; npm currently reports no available fix.
- Remaining ESLint/TypeScript ESLint moderate findings are transitive toolchain findings with no direct fix available from the current npm graph.

A normal `npm audit fix --dry-run --ignore-scripts` preview proposes non-breaking fixes for Vite, Vitest, `body-parser`, `qs`, and `source-map-js`, plus ESLint package updates. It proposes no production forcing of `zod` 4.x. A normal patch remediation should be run separately with tests and reviewed lockfile diff; `npm audit fix --force` must not be used.

## Deployment Recommendation

Configure Render with:

- Health Check Path: `/health`.
- `CORS_ORIGIN=https://freclean.com`.
- `CARD_PAYMENTS_ENABLED=false` until a certified provider is explicitly approved and configured.
- Existing PostgreSQL and JWT secrets remain in the Render secret environment only.
- Database migrations are applied before traffic is enabled.
- The Session Pooler URL for Supabase project `rfpqjfbeeisnzexzonkx` must be verified by hostname, project reference, port, username, database, and SSL mode before deployment verification.

The readiness endpoint should be monitored separately after migration and database recovery; it is not suitable as a substitute for liveness.
