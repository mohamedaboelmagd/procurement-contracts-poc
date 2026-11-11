# ADR-0002: MongoDB documents per aggregate, multi-document transactions, optimistic concurrency

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Tech lead

## Context

Money and approvals must be consistent: approving the last step of a change order has to update the
change order, revise the contract (schedule of values, value, dates, version history), append audit
entries and queue an event, all or nothing. Two approvers can click at the same moment.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Normalise everything (lines in their own collections) | Small documents | Many writes per action, joins in app code |
| **Document per aggregate** (RFx with lines/invitations, contract with SOV/revisions, CO with lines/steps) | One read, one write per aggregate; matches how the UI loads data | Large documents for huge contracts; reporting needs projections |
| Pessimistic locks | Simple mental model | Not native in MongoDB; deadlocks and stuck locks |

## Decision

- One document per aggregate root, `_id` = domain id, `version` field on every document.
- Every update is `replaceOne({ _id, tenantId, version: expected - 1 })`; zero matches → `ConcurrencyError`.
  The service retries the whole unit of work with jittered backoff (`withConflictRetry`), which
  re-reads and re-applies the business rules, so the loser of a race gets a clean 409 instead of a
  lost update.
- Changes that touch several documents run in a **multi-document transaction** (`session.withTransaction`,
  snapshot read concern, majority write concern). That requires a replica set, so local Docker and the
  tests run a single-node replica set.
- HTTP edits use `ETag`/`If-Match` (the version) so a user editing a stale form gets 412.
- An in-memory adapter implements the same semantics (buffered writes, commit-time version checks,
  unique keys) for unit tests and the browser demo.

## Consequences

- API tests run against a real `mongod` (`mongodb-memory-server` replica set) and cover a racing
  double approval and a forced mid-transaction failure.
- Contracts with thousands of SOV lines would need the lines split out (bucket pattern) to stay well
  under the 16 MB document limit; revisit past ~2k lines.
- Reporting (spend by supplier, change-order trends) should read projections, not these documents.
