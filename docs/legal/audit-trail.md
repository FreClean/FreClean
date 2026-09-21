# Legal and Compliance Audit Trail

The audit trail records changes to legal and compliance metadata. It must not
store private credentials, secrets, identity numbers, bank details, payment
credentials, or the contents of confidential evidence.

## Audit record

| Field | Record |
| --- | --- |
| Event ID | PENDING |
| Timestamp | PENDING |
| Actor | PENDING |
| Action | PENDING |
| Document | PENDING |
| Previous Status | PENDING |
| New Status | PENDING |
| Reason | PENDING |
| Evidence Reference | PRIVATE / CONFIDENTIAL; PENDING |
| Reviewer | PENDING |
| Approval Status | PENDING |

## Audit controls

- Every status change should identify the actor, reason, and evidence reference.
- Evidence references should point to the private data room without exposing
  document contents or confidential identifiers in this repository.
- A reviewer should verify authoritative evidence before a status is changed to
  `VERIFIED` or `AVAILABLE`.
- Pending legal decisions must remain pending until explicitly confirmed.