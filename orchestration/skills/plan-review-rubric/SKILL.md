---
name: plan-review-rubric
description: Deterministic checklist for reviewing a single task file from a plan bundle (produced by chuck-architect). Walks through structural, concreteness, agent-assignment, convention, UX, and testability checks in fixed order. Invoke once per task file during plan review. Returns categorized findings (critical/major/minor); verdicts are decided globally by the reviewer, not at task level.
---

# Plan Review Rubric

This skill provides a deterministic walkthrough for reviewing **one task file** from a plan bundle. Walk every step in order. Do not skip. Produce findings in the structure at the end.

## Inputs

- `<task-file-path>`: path to a single task file (e.g. `.claude/reports/chuck-architect/<bundle>/task-NN-<slug>.md`)
- The project's `CLAUDE.md` at the repo root (domain map and conventions)
- The bundle's `plan.md` (master plan; read for context, do not review here)

## Steps

### 1. Structural completeness

The task file MUST contain each of the following non-empty fields:
- `TASK_ID` (matches filename without extension)
- `ASSIGNED_AGENT`
- `ASSIGNED_REPO` (member id; may be omitted only in a single-repo workspace)
- `ORDER`
- `DEPENDS_ON` (list; may be empty)
- `GOAL`
- `WHY`
- `INTERFACE` (endpoints / dtos / events; per-field "n/a" allowed)
- `UX` (REQUIRED only if assigned to a frontend agent AND task involves user-facing change; otherwise must be omitted entirely)
- `SCOPE_BOUNDARIES` (touch + do-not-touch lists)
- `FILES_AFFECTED`
- `DONE_WHEN`
- `ESCALATE_BACK_IF`

Any missing or empty required field → **critical**.

### 2. Concreteness

Walk every reference to a file, function, or pattern in the task. For each:
- Use Glob/Grep to verify path exists OR is plainly a new file the task creates.
- For "modify X", X must exist today.
- For "follows pattern Y", find one example of Y in the codebase.

Hand-wave language ("various converters", "the relevant component", "appropriate service") → **major**.
A cited file, function, or pattern that does not exist → **critical** (record under `UNVERIFIED CLAIMS`).

### 3. Agent and member assignment

Read the `ASSIGNED_REPO` member's `CLAUDE.md` domain map. Confirm:
- `ASSIGNED_REPO` names a real workspace member (per the workspace profile)
- Every path in `FILES_AFFECTED` lives inside that member; none crosses into another member
- `ASSIGNED_AGENT` fits the task type (`chuck-engineer` for a code-implementation task)
- Every path in `SCOPE_BOUNDARIES.touch` lives inside the member and matches the CLAUDE.md domain map
- No path appears in both `touch` and `do-not-touch`

Wrong agent for the work → **critical**.
Wrong/unknown member, or files spanning members → **critical**.
Scope leak across domains → **critical**.

### 4. Project convention alignment

Read the project's `CLAUDE.md` for domain-specific conventions (frameworks, patterns, ID systems, schema styles). Check:
- The task's approach uses the project's established patterns rather than introducing new ones
- Data shapes match the project's conventions (e.g. Identity/Display split if backend, flat models via converters if frontend)
- No invariant visible in the task description is violated

Convention violation → **major** (escalate to **critical** if it breaks an invariant or contract).

### 5. UX completeness (frontend tasks with user-facing change only)

If `ASSIGNED_AGENT` is a frontend agent AND the task touches user-facing code, `UX` must include:
- A step-by-step user flow
- A mockup or layout note for any new/changed screen
- Edge states: empty, loading, error
- Accessibility notes for non-obvious cases

Missing `UX` section on a user-facing task → **critical**.
Missing edge states → **major**.
Any "TBD" or "decide later" placeholder in UX → **critical**.

### 6. Testability

`DONE_WHEN` must contain:
- Measurable acceptance criteria (not "feature works")
- A reference to the project's convention check / lint / tests where applicable

Vague or untestable acceptance → **major**.

## Output

Return findings in this shape:

```
TASK: <task file path>
ASSIGNED_AGENT: <as declared>

CHECKS:
  structural: pass | fail (list missing fields)
  concreteness: pass | fail (list hand-waves)
  agent_assignment: pass | fail (list issues)
  convention: pass | fail (list violations)
  ux: pass | n/a | fail (list gaps)
  testability: pass | fail (list gaps)

FINDINGS:
  critical:
    - <finding>
  major:
    - <finding>
  minor:
    - <finding>

UNVERIFIED CLAIMS:
  - <plan claim that did not match the codebase when spot-checked>
```

Do NOT produce a verdict at task level. Verdicts are decided globally by the reviewer after synthesis across all tasks.
