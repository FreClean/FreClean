# Security Checklist

This is the checklist this repo should be audited against before each
production release. Update it as new attack surface is added — don't treat
having a library installed as proof a class of bug is handled.

- [ ] Authentication: password hashing (argon2id), rate-limited login
- [ ] Authorization: every route checks server-side role, never trusts client role claims
- [ ] Session security: short-lived access tokens, refresh rotation
- [ ] SQL injection: parameterized queries only (no string-built SQL)
- [ ] XSS / CSRF: API is stateless JSON — confirm frontend CSRF story separately
- [ ] IDOR: every resource lookup scoped to the authenticated user/role
- [ ] Rate limiting on auth and payment-sensitive endpoints
- [ ] Input validation with zod on every route
- [ ] Payment manipulation: prices/availability always recalculated server-side
- [ ] Webhook forgery: signature verification + idempotency + replay protection
- [ ] Cash-payment fraud: staff-only recording, reconciliation, audit trail
- [ ] Secrets: never committed, never in frontend bundles
- [ ] Dependency vulnerabilities: `npm audit` in CI
- [ ] Sensitive logging: no card data, no secrets, no full tokens in logs
