# FreClean API Contract

## Ownership

- `FreClean/FreClean` owns the `/api` contract, business rules, PostgreSQL schema, migrations, authentication, authorization, and payment state.
- `FreClean/freclean-app` is a client of the API for customer, staff, manager, admin, and owner workflows. It must not write PostgreSQL or reimplement business rules.
- `FreClean/freclean-website` is a public client. It may use approved public API endpoints and must not access PostgreSQL.
- `FreClean/.github` owns organization-wide CI/CD workflows, security policies, templates, and reusable automation.

## API and compatibility

The current API is under `/api`. JSON request and response shapes are versioned through additive, backward-compatible changes. Breaking changes require a new version prefix, migration notes, and coordinated releases of the app and website. Clients must not infer business state from local calculations.

Every protected request uses `Authorization: Bearer <access-token>`. The API is the only authority for identity, roles, service/product data, booking state, order state, and payment state.

## Payment contract

The supported methods are `CRYPTO`, `CARD`, and `CASH`. Crypto assets are `CELO` and `USDm`. Payment status is read-only client data: only server-side chain verification, processor-signed webhook handling, or authorized cash reconciliation can change it. Payment mutations require idempotency keys or provider event identifiers where applicable.

## Environment and deployment

Runtime configuration is supplied through environment variables documented in `.env.example`. Secrets, database credentials, processor credentials, and wallet keys are never committed. Deployments apply migrations before starting the API, expose `/health` for liveness and `/health/ready` for database readiness, and support graceful `SIGTERM` shutdown.

## Release process

1. Run build, lint, tests, migration validation, and security checks.
2. Merge only when required checks pass.
3. Deploy the core API and migrations first when a contract or schema change requires it.
4. Deploy app and website clients compatible with the released API.
5. Run readiness and smoke checks, then monitor structured logs and audit records.

The other repositories must adopt this contract in their own README and CI configuration before a cross-repository release is considered complete.
