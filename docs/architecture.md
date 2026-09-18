# Architecture Overview

FreClean is split across exactly four repositories:

- **FreClean/FreClean** (this repo) — backend/API/DB, the only writer to production data
- **freclean-website** — public marketing/informational site
- **freclean-app** — the customer/staff/admin application, talks to this API
- **FreClean/.github** — organization-wide workflows, templates, policies and CI/CD

See the root `README.md` of each repo. Business rules (booking lifecycle,
order lifecycle, payment state machine, RBAC) live only in this repo.

The versioned API under `/api` is the only integration boundary for the app and
website. Clients must treat payment status as read-only data returned by this
API. PostgreSQL credentials and write access remain exclusive to this repo.
