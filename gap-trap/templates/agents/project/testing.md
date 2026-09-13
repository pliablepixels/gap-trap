# Testing playbook

Read before tests, UI work, or platform checks.

## Test design

- Test outcomes a person sees: changed data, navigation, rendered real
  data, persistence, errors, and edge cases. Never element existence or
  child count (C6).
- Name the seams under test in the issue or brief before writing a test:
  the highest interface that reaches the behavior, ideally one. Mock only
  the system boundary (`{{API_BOUNDARY}}`); a mock of the repo's own
  modules is counted by the quality ratchet and may not multiply.
- Prove red before green: run the new test against the pre-change code
  and show it fail (`{{PROVEN_RED_CMD}} <base> <head>`; CI runs it on
  every PR). A bug fix starts with that red command, shown, before any
  code is read for a theory.
- A new gate assertion (anything under `{{GATE_DIR}}`) is proven red
  against a scratch violation, then the scratch is removed in the same
  commit.
- Route tests by tier: pure logic gets unit tests beside the source;
  user-visible behavior gets an end-to-end scenario plus units for the
  logic beneath. End-to-end asserts the journey, units the edge cases;
  never the same assertion in both.
- No fixed sleeps. Use auto-retrying assertions.
- New interactive UI needs a stable test id. Repeated elements suffix the
  entity id; variants suffix kind or role.

## Commands

```bash
{{TEST_CMD}}
{{E2E_CMD}}
```

## Traps that have burned agents

- {{Add one per incident, with the commit hash. Delete this line.}}
