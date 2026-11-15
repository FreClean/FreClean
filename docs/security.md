# Security Checklist

This is the checklist this repo should be audited against before each
production release. Update it as new attack surface is added — don't treat
having a library installed as proof a class of bug is handled.

- [ ] Authentication: password hashing (argon2id), rate-limited login
- [ ] Authorization: every route checks server-side role, never trusts client role claims
- [ ] Session security: short-lived access tokens; refresh checks the current active account and roles (refresh-token rotation/revocation is not implemented)
- [ ] SQL injection: parameterized queries only (no string-built SQL)
- [ ] XSS / CSRF: API is stateless JSON — confirm frontend CSRF story separately
- [ ] IDOR: every resource lookup scoped to the authenticated user/role
- [ ] Rate limiting on auth and payment-sensitive endpoints
- [ ] Input validation with zod on every route
- [ ] Payment manipulation: prices/availability always recalculated server-side
- [ ] Crypto payment verification: server-side network, token, recipient, amount, success, and finality checks
- [ ] Payment replay protection: unique transaction hashes and idempotent payment creation
- [ ] CeloHT settlement: keep payments pending until an authoritative server-side integration exists
- [ ] Contact delivery: persist enquiries and notification jobs atomically; retry Resend delivery idempotently
- [ ] Secrets: never committed, never in frontend bundles
- [ ] Dependency vulnerabilities: `npm audit` in CI
- [ ] Sensitive logging: no secrets, credentials, or full access tokens in logs
