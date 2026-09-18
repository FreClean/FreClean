# Architecture Overview

FreClean is split into three product repositories:

- **freclean** (this repo) — backend/API/DB, the only writer to production data
- **freclean-website** — public marketing/informational site
- **freclean-app** — the customer/staff/admin application, talks to this API

See the root `README.md` of each repo. Business rules (booking lifecycle,
order lifecycle, payment state machine, RBAC) live only in this repo.
