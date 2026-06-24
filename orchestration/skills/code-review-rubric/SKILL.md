---
name: code-review-rubric
description: Deterministic checklist for reviewing the code changes that closed a single completed task. Walks through contract adherence, scope, convention, correctness, tests, maintainability, and security/perf checks in fixed order. Invoke once per completed task during code review. Returns categorized findings (critical/major/minor) and contract drift; verdicts are decided globally by chuck-code-reviewer, not at task level.
---

# Code Review Rubric

This skill provides a deterministic walkthrough for reviewing the code changes that closed **one task**. Walk every step in order. Do not skip. Produce findings in the structure at the end.

## Inputs

- `<task-contract>`: path to the task file (or inline contract text)
- `<engineer-report>`: path to the engineer's report (`.claude/reports/chuck-{frontend,backend}-engineer/<ts>.md`)
- `<diff-scope>`: git range or working-tree scope to inspect (provided by the reviewer; commonly `git diff <baseline>..HEAD -- <paths>`)
- The project's `CLAUDE.md` at the repo root (domain map and conventions)

## Steps

### 1. Contract adherence

Compare the engineer's `FILES CHANGED` (from report) and the actual changed files (from diff) against the task contract:

- Every file in `FILES_AFFECTED` (from contract) appears in `FILES CHANGED`. Missing file → **major**.
- Every changed file is either in `FILES_AFFECTED` or clearly necessary collateral (imports, barrel exports). Unjustified extra file → **major** (escalate to **critical** if outside `SCOPE_BOUNDARIES.touch`).
- For backend tasks, `INTERFACE EXPOSED` (in report) matches `INTERFACE` declared in the task contract — endpoint paths, DTO field shapes, event names and payloads. Mismatch → **critical**.
- For frontend tasks, `INTERFACE CONSUMED` (in report) matches what the diff actually consumes from the backend. Mismatch → **major**.

### 2. Scope boundary

Check every changed file against `SCOPE_BOUNDARIES.touch` and `do-not-touch`:

- File outside `touch` → **critical**.
- File in `do-not-touch` modified → **critical**.

### 3. Convention alignment

Read the project's `CLAUDE.md` for domain-specific conventions. For each changed file in the diff:

- Project conventions respected (e.g. Identity/Display split on backend, OnPush/signals on frontend, barrel exports — whatever the project mandates).
- Engineer's report claims `convention check: pass`. Verify the claim is plausible from the diff (no obvious violations visible).

Convention violation visible in diff → **major** (or **critical** if it breaks an invariant).
Engineer claims pass but diff contradicts → **critical**.

### 4. Correctness

Read each changed file, focusing on the diff hunks. Look for:

- Logic errors (off-by-one, wrong operator, inverted condition, wrong default)
- Missing edge case handling (null, empty, concurrent access, large input, partial failure)
- Resource leaks (subscriptions not cleaned up, connections/files not closed, timers not cleared)
- Error handling: exceptions silently swallowed, errors not surfaced to user, error states unreachable
- Async / promise mistakes (missed await, unhandled rejection, race conditions, parallel work that should be serial)

Severity:
- Will cause user-visible bug or data corruption → **critical**
- Will degrade quality / cause edge-case bugs → **major**
- Code smell, brittle but working → **minor**

### 5. Tests

Check the diff for test coverage of the new behavior:

- New code paths have at least one test exercising the happy path.
- Edge cases identified in step 4 are covered (or explicitly waived with reasoning in NOTES).
- Tests have meaningful assertions (not just "doesn't throw" or "is truthy").
- No test was disabled, `.skip`'d, or commented out without justification.

Missing tests for new behavior → **major** (or **critical** for sensitive paths: auth, payments, data migrations, security-sensitive logic).

### 6. Maintainability

- Naming clear and consistent with project style.
- No dead code introduced (unused imports, unreachable branches, leftover console.logs).
- No commented-out blocks left in.
- Complexity is justified — long function, deep nesting, magic numbers should have a reason.
- Comments explain *why* when non-obvious; no `// fixed bug X` rot or stale TODOs.

Issues here are usually **minor**; escalate to **major** when complexity will obstruct future work in the same area.

### 7. Security and performance (if relevant to the task)

- Input validated at trust boundaries (request handlers, deserializers, file/network reads).
- No secrets, tokens, or PII appearing in logs, error messages, or commit content.
- Authentication/authorization not bypassed or weakened.
- No accidental O(n²) where O(n) suffices in hot paths.
- No unnecessary work in render / event handler / hot-loop paths.
- Migrations are idempotent and safe under concurrent writes.

Security regression → **critical**. Performance regression severity depends on user-visible impact.

## Output

Return findings in this shape:

```
TASK: <task contract path or "inline">
ENGINEER: chuck-frontend-engineer | chuck-backend-engineer
DIFF SCOPE: <as provided>

CHECKS:
  contract_adherence: pass | fail (list issues)
  scope: pass | fail (list issues)
  convention: pass | fail (list issues)
  correctness: pass | fail (list issues)
  tests: pass | fail (list issues)
  maintainability: pass | fail (list issues)
  security_perf: pass | n/a | fail (list issues)

FINDINGS:
  critical:
    - <finding>: <which check>
  major:
    - <finding>: <which check>
  minor:
    - <finding>: <which check>

CONTRACT DRIFT:
  - <change in code that deviates from the task contract, with assessment>
```

Do NOT produce a verdict at task level. Verdicts are decided globally by chuck-code-reviewer after synthesis across all tasks.
