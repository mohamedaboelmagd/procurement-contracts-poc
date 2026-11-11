# ADR-0001: Start as a modular monolith with service boundaries, not separate microservices

- **Status:** Accepted
- **Date:** 2026-11-11
- **Deciders:** Tech lead

## Context

The product has three areas with different owners and change rates: **identity** (users, tokens,
supplier API clients), **sourcing** (RFI/RFQ/RFP events, sealed bids, levelling, award) and
**contracts** (contracts, schedule of values, change orders, approvals). The award is the only
hand-off between sourcing and contracts.

The team is small, the domain model is still moving, and award → contract must never lose data.
Separate deployables would add network failure modes, distributed tracing and contract testing
before we know where the real scaling pressure is.

## Options considered

| Option | Pros | Cons |
|---|---|---|
| Microservices now (one per area, own DB) | Independent deploys and scaling | Distributed transactions/sagas on day one, more infra, slower refactors |
| Plain monolith (shared models, direct calls) | Fastest to start | Boundaries erode; splitting later is a rewrite |
| **Modular monolith** (modules own collections, talk through events) | One deploy, real boundaries, cheap to split later | Discipline needed to keep boundaries (reviews, lint rules) |

## Decision

One Express process, three modules with hard boundaries:

- Each module owns its collections. `contracts` never reads `rfx` or `bids`.
- Cross-module communication is only through **integration events** (`shared/events.ts`). The award
  event carries the bid lines the contract needs (event-carried state).
- Events are written to an **outbox** in the same MongoDB transaction as the state change and
  published after commit; handlers are idempotent (unique `(tenantId, rfxId)` on contracts).
- Machine clients (supplier ERPs) get their own route group (`/supplier/v1`) and token type, which
  is the natural first service to extract.

## Consequences

- Splitting a module out means replacing the in-process `EventBus` with a broker (e.g. a managed
  queue reading the outbox) and giving the module its own database. No domain code changes.
- Reviewers check imports across module folders; a lint rule (e.g. `eslint-plugin-boundaries`) is a
  follow-up.
- Revisit when one module needs a different scaling profile (supplier bid traffic at deadlines is
  the likely first) or a separate team owns it end to end.
