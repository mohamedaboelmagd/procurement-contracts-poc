## What and why

<!-- One paragraph: the problem, the change, and the link to the issue / ADR. -->

## How to verify

- [ ] `npm test` (backend unit + API, frontend components)
- [ ] Manual check in the demo, if UI changed (screenshot below)

## Checklist (see ENGINEERING_PLAYBOOK.md)

- [ ] Money stays in integer minor units; no floats in calculations
- [ ] New rules live in the domain/service layer, with tests, not in controllers or components
- [ ] Permission checks and tenant scoping on every new read/write
- [ ] State changes + their events/audit entries happen in one transaction
- [ ] API change? OpenAPI updated and backwards compatible (or versioned)
- [ ] ADR added/updated for decisions that are hard to reverse
