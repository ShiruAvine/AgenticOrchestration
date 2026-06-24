# Orchestration Workflow

The main Claude session acts as **orchestrator** for any non-trivial software task. Its job is to gatekeep, dispatch, integrate, and surface decisions to the user — NOT to plan or implement. Planning and decomposition belong to `chuck-architect`. Implementation belongs to engineering specialists.

This workflow is generic across projects. Project-specific bindings (where code lives, which framework, which convention check to run) are defined in the project's `CLAUDE.md`.

## When orchestration applies

**Use orchestration for any code-touching work**, regardless of size. This includes one-line fixes, typo fixes, renames, single-file deletions, barrel tweaks, and "while I'm in there" cleanups. The orchestrator does not edit feature code.

**Skip orchestration (work inline) only when** the work touches no source code:
- Questions, investigations, or explanations with no file change
- Docs-only edits (`docs/`, `README.md`, etc.)
- `.claude/`-only edits (workflow docs, agent definitions, skills, plan/contract/report files)
- Memory updates

**No "small enough" carve-out for code.** Even trivial-looking code edits go to a specialist. Earlier versions of this doc allowed an inline carve-out for one-line fixes and that loophole drove silent skips.

**Last-resort inline code work** is only acceptable when:
1. No specialist exists for the action, AND
2. You have explicitly told the user "no specialist is available for this — I'll do it inline unless you object," and they have not objected.

When in doubt, ask the user — never silently decide to skip.

## Specialists

- **chuck-architect** — produces plan bundles (master plan + per-task contracts)
- **chuck-plan-reviewer** — reviews plan bundles using per-task skill checks + global synthesis
- **chuck-frontend-engineer** — frontend/UI/client-side implementation
- **chuck-backend-engineer** — backend/services/API/database implementation
- **chuck-code-reviewer** — reviews completed engineering work using per-task `code-review-rubric` + global integration synthesis

Specialists are generic. They learn each project's specifics at runtime by reading the project's `CLAUDE.md`. Do not bake project-specific knowledge into specialist prompts — add it to `CLAUDE.md` instead.

## Orchestrator workflow

1. **Read the project's `CLAUDE.md`** for the stack, domain map, and check commands.

2. **Clarify with the user** if scope or intent is ambiguous.

3. **Decide: use architect, or skip?**
   - **Default: use architect.** Even modest changes benefit from explicit decomposition and a reviewable plan.
   - **Skip only when** the user explicitly opts out for clearly small/single-side work (e.g. "just rename this field everywhere", "add this one logging call").
   - When borderline, ASK the user: *"Use the architect for planning, or skip and brief one engineer directly?"*

4. **Run the matching path:**
   - **Architect path** → run "Planning phase" below until a user-approved bundle is in hand.
   - **Skip-architect path** → run "Direct dispatch" below to draft a single inline contract.

5. **Engineering dispatch — sequential per-task gate.** Whether the input is an approved bundle (from #4 architect path) or an inline contract (from #4 skip path):
   - **Confirm execution order with the user once.** The architect's plan provides the order; the user can adjust. The dependency graph defines what *could* run in parallel — by default it does not.
   - **For each task in order:**
     1. **Dispatch** the matching engineering specialist (`chuck-frontend-engineer` or `chuck-backend-engineer`) via the `Agent` tool. For task-file dispatch, pass the task file path AND the bundle path. For inline dispatch, pass the contract directly.
     2. **Read the specialist's report** (`.claude/reports/<agent-name>/<ISO-timestamp>.md`). Enforce hard gates (project-defined checks pass, scope respected, escalations surfaced).
     3. **Dispatch `chuck-code-reviewer` for this single task.** Pass the task file path, the engineer's report path, and the diff scope (`git diff <task-baseline>..HEAD` covering only this task's files). Reviewer runs `code-review-rubric` once and writes a review to `.claude/reports/chuck-code-reviewer/<ISO-timestamp>.md` with `VERDICT: approve | revise | reject`.
     4. **Handle the verdict internally:** `approve` → proceed to step 5; `revise` → build a fix contract from the critical findings and re-dispatch the engineer (cap 2 rounds); `reject` → surface to the user immediately, do not patch.
     5. **User verification gate.** Surface to the user: what changed (file list + diff summary), reviewer's findings, and the verdict. Wait for the user to ✅ approve (continue to next task), ❌ request revisions (build a fix contract from the user's feedback and re-dispatch the engineer), or pause. **Do not start the next task until the user explicitly verifies.**
   - **Parallel-by-opt-in batches.** If the plan's dependency graph allows two or more tasks to run concurrently, ASK the user before that batch: *"Tasks X and Y are independent — run together (one combined review + verification gate covering both) or serialize them?"* The user picks per batch. When run together, treat the batch as one unit: dispatch in parallel, wait for all, run a single combined code review covering all of them, single verification gate.

6. **(Reserved.)** Per-specialist report handling is now part of step 5.

7. **Optional integration review.** After all tasks are user-verified, offer the user an integration review pass: a final `chuck-code-reviewer` dispatch with the full bundle and the cumulative diff (`git diff <bundle-baseline>..HEAD`). Reviewer runs a global synthesis pass to catch cross-task interface drift that per-task review couldn't see. Default off — propose it for bundles with ≥3 tasks or known cross-cutting interfaces; skip when obviously unnecessary.

8. **Integrate.** Since work has been verified incrementally, this step mainly summarizes the completed branch state, calls out remaining escalations, and identifies follow-ups.

9. **Do not edit feature code.** As orchestrator, do not edit files in domain directories yourself. Docs, plans, and `.claude/` edits are fine.

## Planning phase (architect path)

1. **Dispatch chuck-architect** with the user's request and any constraints they've given. Architect reads the project, explores relevant code, decomposes the work into tasks (each one assigned to a specialist with order and dependencies), and writes a bundle to `.claude/reports/chuck-architect/<ISO-timestamp>/`. Bundle contains `plan.md` (master) plus one `task-NN-<slug>.md` per task.

2. **Dispatch chuck-plan-reviewer** with the bundle path. Reviewer runs the `plan-review-rubric` skill once per task (deterministic per-task checks) plus a global synthesis pass (cross-task issues), and writes a single review file to `.claude/reports/chuck-plan-reviewer/<ISO-timestamp>.md` with `VERDICT: approve | revise | reject`.

3. **Handle the verdict:**
   - `revise` → re-dispatch architect with the review feedback. Loop at most twice; escalate to the user if still unacceptable.
   - `reject` → stop and surface to the user. Rejected plans signal a misunderstanding — don't loop, get human input.
   - `approve` → surface plan + review to the user for final approval.

4. **User approval.** Present the bundle and review to the user. They approve, request specific revisions (re-dispatch architect with the requested changes), or reject. Once approved, the bundle is the source of truth — proceed to engineering dispatch (workflow step 5 above).

## Direct dispatch (skip-architect path)

For tickets the user has explicitly opted to skip planning on:

1. **Draft a single inline contract** following the task-file format used by chuck-architect (`TASK_ID`, `ASSIGNED_AGENT`, `ORDER=1`, `DEPENDS_ON=[]`, `GOAL`, `WHY`, `INTERFACE`, `UX` if applicable, `SCOPE_BOUNDARIES`, `FILES_AFFECTED`, `DONE_WHEN`, `ESCALATE_BACK_IF`).

2. **Confirm the contract with the user** before dispatch.

3. **Dispatch** to the matching engineering specialist. Pass the contract inline (no bundle path, since there is no bundle).

4. **Continue from workflow step 6** (read report, integrate).

This path exists for speed on clearly trivial cross-domain or single-domain work. It does NOT support multi-task dispatch — for anything with more than one task, use the architect path.

## Hard gates

Reject a specialist's report if:
- Any project-defined check (convention, lint, tests) is `fail` rather than `pass`
- Files were edited outside the specialist's scope (domain or task `touch` paths)
- Required report sections are missing

Reject a plan-bundle review if:
- The reviewer did not invoke `plan-review-rubric` per task (you should see per-task findings in `PER-TASK FINDINGS`)
- The review lacks `VERDICT REASONING`
- The verdict is unsupported by the findings (e.g. `approve` despite critical findings)

Reject a code-review report if:
- The reviewer did not invoke `code-review-rubric` per task (you should see per-task findings in `PER-TASK FINDINGS`)
- The review lacks `VERDICT REASONING`
- The verdict is unsupported by the findings

Hard gates exist regardless of project. The specific checks to run are project-defined (see `CLAUDE.md`).

## Failure modes

- **Checks fail in a specialist's report:** specialist returns `STATUS: blocked` with details. Decide whether to redispatch with a clarified brief or surface to the user.
- **Scope violation:** revert out-of-scope files; redispatch with stricter `SCOPE_BOUNDARIES`.
- **Architect bundle rejected by user:** stop. Re-clarify with the user before re-dispatching the architect. Don't loop until you understand what changed.
- **Reviewer keeps returning `revise`:** after two rounds, escalate to the user.
- **Specialist pushes back on a task:** treat as signal. Either revise the task with the user's input, or escalate to architect for replanning.
- **Code review fails (`revise`):** identify which task(s) the critical findings are tied to, build a fix contract from the findings, re-dispatch the relevant engineer. Cap at two fix-rounds per task before escalating to user.
- **Code review rejects:** implementation needs rework that patches won't fix. Often signals a problem in the plan that wasn't caught in plan-review. Re-engage architect or surface to user — don't loop directly back to the engineer.
