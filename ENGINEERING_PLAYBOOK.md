# Engineering playbook

How this codebase is meant to be worked on by a team: branching, reviews, decisions and what
"done" means. Short on purpose; change it by pull request like any other code.

## 1. Branching and commits

- **Trunk-based.** `main` is always releasable and protected (CI green + one approving review).
- Short-lived branches from `main`: `feat/<ticket>-short-name`, `fix/<ticket>-…`, `chore/…`, `docs/…`.
  Aim to merge within 2 days; split work behind a feature flag rather than keep a long branch.
- **Conventional commits** (`feat(contracts): revise SOV on CO approval`) so changelogs and version
  bumps can be generated. Squash-merge; the PR title becomes the commit message.
- Rebase on `main` before review if the branch is behind; never force-push a shared branch.
- Releases are tags on `main` (`vX.Y.Z`); hotfixes branch from the tag and are merged back.

## 2. Pull requests

- **Small:** under ~400 changed lines of production code. Bigger changes get a design note or ADR first.
- The PR template asks for what/why, how to verify, screenshots for UI, and the checklist below.
- One reviewer minimum, two for auth, money calculations, migrations or anything in `shared/`.
- Author owns the PR to merge: respond to every comment, resolve or open a follow-up ticket.
- Review turnaround target: first pass within one working day.

## 3. Code review checklist

**Correctness and domain**
- [ ] Business rules live in the domain/service layer (`sourcing/`, `contracts/`), not in Express handlers or React components.
- [ ] Money is integer minor units end to end; rounding happens once, in `shared/money.ts`.
- [ ] State transitions go through the state machine / workflow functions; no ad-hoc `status = …`.
- [ ] Every state change that matters is audited and, if other modules care, emitted as an event in the same transaction.

**Security and data**
- [ ] Every read and write is tenant-scoped and permission-checked (`authorize`, resource rules). Missing resources and forbidden ones both return 404 where existence itself is sensitive.
- [ ] Input validated at the edge with zod; nothing from the client is trusted for prices, totals or roles.
- [ ] No secrets, tokens or PII in logs, errors or audit `details`. Sealed-bid prices never appear before opening.
- [ ] Concurrency considered: versioned updates, retries only on `ConcurrencyError`, idempotent event handlers.

**API and compatibility**
- [ ] REST semantics and status codes are consistent (`400` validation, `401/403/404`, `409` state/conflict, `412` stale `If-Match`).
- [ ] OpenAPI reflects the change; breaking changes go to a new version (`/v2`) or behind a flag.
- [ ] Database changes are backwards compatible with the previous release (expand → migrate → contract).

**Quality**
- [ ] Tests at the right level: unit for rules, API test for the HTTP contract, component test for UI behaviour. A bug fix starts with a failing test.
- [ ] Names say what things are in domain language (RFx, bid, schedule of values, change order).
- [ ] No dead code, no commented-out code, no TODO without a ticket.
- [ ] Frontend: accessible labels on inputs, keyboard reachable actions, no layout shift on load, loading and error states.

**How to comment**
- Prefix comments: `blocker:`, `suggestion:`, `question:`, `nit:`. Only `blocker:` stops a merge.
- Explain the why and propose an alternative. Praise good solutions too.

## 4. Architecture decisions (ADRs)

- Write an ADR for anything expensive to reverse: data model, module boundaries, auth, a new
  dependency in a core path, a cross-cutting pattern.
- Template: [`docs/adr/0000-template.md`](docs/adr/0000-template.md). Number sequentially, never edit an
  accepted ADR's decision; supersede it with a new one.
- Current decisions:
  - [ADR-0001](docs/adr/0001-modular-monolith.md) Modular monolith with event-based boundaries
  - [ADR-0002](docs/adr/0002-mongodb-consistency.md) MongoDB documents, transactions, optimistic concurrency
  - [ADR-0003](docs/adr/0003-auth-tokens.md) JWT + rotating refresh tokens + OAuth 2.0 client credentials

## 5. Definition of done

A ticket is done when:

1. Acceptance criteria are met and demoed (or a screenshot/recording is on the PR).
2. Tests cover the new behaviour, and CI is green (typecheck, unit, API, component tests, builds, Docker image).
3. Security checklist items above are satisfied; permissions are added to the role matrix and reviewed.
4. API docs (OpenAPI), README and ADRs are updated where relevant.
5. Observability is in place for new flows: structured logs with `x-request-id`, metrics or alerts for anything that can fail silently (outbox backlog, approval SLA).
6. Feature flag and rollback plan exist for risky changes; data migrations are reversible or have a tested backfill.
7. Product owner has accepted it in a shared environment.

## 6. Working with AI coding assistants

AI assistants are used for scaffolding, test generation, refactors and first drafts of docs. The rules:

- The author is accountable for every line; generated code gets the same review as hand-written code.
- Never paste secrets, customer data or confidential documents into prompts.
- Prefer asking the assistant for **tests first** from the acceptance criteria, then the implementation.
- Money, auth and concurrency code must be read line by line by a human reviewer, whatever produced it.
- Note significant AI assistance in the PR description so reviewers calibrate.

## 7. Team rituals (lightweight)

- Daily 15-minute sync on blockers, not status.
- Weekly architecture slot (30 min): review proposed ADRs, tech-debt items, incidents.
- Blameless post-incident reviews within 3 days, with owners and dates for actions.
- Pairing or mob sessions for onboarding and for gnarly domain rules (levelling, approvals).
