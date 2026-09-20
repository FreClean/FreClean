# Disputes, Complaints and Resolution

## Status

- `IMPLEMENTED`: authenticated dispute creation, ownership-filtered retrieval, structured category/status codes, explicit role permissions, optimistic-concurrency status transitions, customer/internal message visibility, private evidence metadata, and audit entries including sensitive case views.
- `VERIFIED-INTERNAL`: TypeScript build, ESLint, RBAC tests, and dispute state-machine tests pass in this repository.
- `EXTERNAL-REVIEW-REQUIRED`: jurisdiction-specific policy, retention periods, consumer rights, product-safety obligations, and external escalation rules.
- `EXTERNAL-ACTION-REQUIRED`: deploy and configure private evidence storage/malware scanning, a refund domain/provider integration, notifications, and the customer/staff frontend repositories.

## API

The backend is authoritative under `/api/disputes` and requires a signed bearer token.

- `POST /api/disputes`: customer creates a case. The customer ID is taken from the token.
- `GET /api/disputes`: customers see their own cases; assigned staff see assigned cases; management roles with `dispute:view_all` see the queue.
- `GET /api/disputes/:id`: returns the case and only customer-visible messages unless the actor has queue access.
- `POST /api/disputes/:id/messages`: adds a customer-visible message; internal messages require investigation permission.
- `POST /api/disputes/:id/transition`: requires an allowed transition and the current status. The database update is conditional on the supplied current status to prevent lost updates.

Category and status values are canonical machine-readable codes in `src/disputes/model.ts`. Frontends must consume these codes and translate labels independently.

## Security boundary

Case reads and writes are authenticated and filtered by customer ownership or staff assignment. Internal messages are never returned to customers. Every create, message, and status transition writes an audit entry. Public references are random non-sequential values and are not authorization credentials.

The current repository has no evidence storage abstraction or refund table/provider service. The implementation deliberately does not accept file paths, claim uploads succeeded, or execute refunds. Those integrations must be added before enabling evidence or financial resolution controls.

## Data and retention

The migration uses foreign keys for known orders, order items, payments, bookings, products, users, status history, and messages. Retention and deletion/anonymization periods are intentionally policy inputs and require jurisdiction/business/legal review; no universal period is asserted here.