# Orchestration Workflow

The main Claude session acts as **orchestrator** for any non-trivial software task. Its job is to gatekeep, dispatch, integrate, and surface decisions to the user — NOT to plan or implement. Planning and decomposition belong to `chuck-architect`. Implementation belongs to engineering specialists.

This workflow is generic across projects. Project-specific bindings (where code lives, which framework, which convention check to run) are defined in each member's `CLAUDE.md`. Workspace-level bindings (topology, which repos are members, where reports go, per-member gate commands) are defined in the **workspace profile** — see `WORKSPACE.md` and Phase 0 below.

The orchestrator runs against a **workspace**, which may be a single repo, a monorepo, or a parent folder of independent repos. Do not assume the working directory is one git repository. `WORKSPACE.md` defines the topologies and the profile that pins down "which repos", "where reports go", and "what the diff is" for each.

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

0. **Phase 0 — Establish the workspace.** Before anything else, know what you are pointed at.
   - **Load the workspace profile** (a personal, gitignored file). Look for it at `./.orchestration/workspace.md` (multi-repo) or `./.claude/orchestration/workspace.local.md` (single-repo / monorepo).
   - **If no profile exists**, run `/orchestrate-setup` first (detect topology → confirm with user → write profile). Do not proceed without one — guessing topology is what drives drift. See `WORKSPACE.md`.
   - **If a profile exists**, read it. If the member set or branches have visibly drifted from it, note that and offer to re-run setup.
   - **Resolve this run's scope.** From the profile's in-scope members, determine which the ticket touches — by the user's explicit statement, by inference, or by asking. The active member set may be one member, several, or all. Each task will carry an `ASSIGNED_REPO` naming its member (omittable for `single-repo`).

1. **Read each active member's `CLAUDE.md`** for the stack, domain map, and check commands. Use the gate commands recorded in the profile for each member.

2. **Clarify with the user** if scope or intent is ambiguous.

3. **Decide: use architect, or skip?**
   - **Default: use architect.** Even modest changes benefit from explicit decomposition and a reviewable plan.
   - **Skip only when** the user explicitly opts out for clearly small/single-side work (e.g. "just rename this field everywhere", "add this one logging call").
   - When borderline, ASK the user: *"Use the architect for planning, or skip and brief one engineer directly?"*

4. **Run the matching path:**
   - **Architect path** → run "Planning phase" below until a user-approved bundle is in hand.
   - **Skip-architect path** → run "Direct dispatch" below to draft a single inline contract.

5. **Engineering dispatch — sequential per-task gate.** Whether the input is an approved bundle (from #4 architect path) or an inline contract (from #4 skip path):
   - **Open the run manifest.** Before dispatching anything, create the run manifest (see "Run manifest" below) and capture a **per-member baseline** (`git -C <member-path> rev-parse HEAD`) for every active member. The manifest is the run's source of truth for status and diff baselines — update it at every transition so the run is resumable.
   - **Confirm execution order with the user once.** The architect's plan provides the order; the user can adjust. The dependency graph defines what *could* run in parallel — by default it does not.
   - **For each task in order** (skip any the manifest already marks `done`):
     1. **Dispatch** the matching engineering specialist (`chuck-frontend-engineer` or `chuck-backend-engineer`) via the `Agent` tool. For task-file dispatch, pass the task file path AND the bundle path. For inline dispatch, pass the contract directly. Always pass the task's `ASSIGNED_REPO` (the member it lives in) so the engineer operates in the right repo and uses that member's gates from the profile. Mark the task `in_progress` in the manifest.
     2. **Read the specialist's report** (in the assigned member's `reports_dir`, `.../chuck-<agent>/<ISO-timestamp>.md`). Record its path in the manifest.
     3. **Independently verify the gates.** Do NOT trust the engineer's self-reported `CHECKS`. Run the `ASSIGNED_REPO` member's gate commands yourself (from the profile, inside the member's path) and record the **observed** result in the manifest. Prefer a non-mutating form of each gate; if only a mutating form exists (e.g. `lint --fix`), any changes it produces become part of this task's diff and are reviewed. The hard gate keys off *your observed* result, not the report. A self-report/observed mismatch is itself a finding to surface.
     4. **Dispatch `chuck-code-reviewer` for this single task.** Pass the task file path, the engineer's report path, the task's `ASSIGNED_REPO`, the manifest's observed gate results, and the diff scope — scoped to that member with the manifest's baseline (`git -C <member-path> diff <task-baseline>..HEAD` covering only this task's files). Reviewer runs `code-review-rubric` once and writes a review to the member's `reports_dir/chuck-code-reviewer/<ISO-timestamp>.md` with `VERDICT: approve | revise | reject`. Record the review path + verdict in the manifest.
     5. **Handle the verdict internally:** `approve` → proceed to the next sub-step; `revise` → build a fix contract from the critical findings and re-dispatch the engineer (cap 2 rounds; increment `fix_rounds` in the manifest); `reject` → surface to the user immediately, do not patch.
     6. **User verification gate.** Surface to the user: what changed (file list + diff summary), the observed gate results, the reviewer's findings, and the verdict. Wait for the user to ✅ approve (mark the task `done` in the manifest, continue to next task), ❌ request revisions (build a fix contract from the user's feedback and re-dispatch the engineer), or pause. **Do not start the next task until the user explicitly verifies.**
   - **Parallel-by-opt-in batches.** If the plan's dependency graph allows two or more tasks to run concurrently, ASK the user before that batch: *"Tasks X and Y are independent — run together (one combined review + verification gate covering both) or serialize them?"* The user picks per batch. When run together, treat the batch as one unit: dispatch in parallel, wait for all, verify each member's gates, run a single combined code review covering all of them, single verification gate.

6. **(Reserved.)** Per-specialist report handling is now part of step 5.

7. **Optional integration review.** After all tasks are user-verified, offer the user an integration review pass: a final `chuck-code-reviewer` dispatch with the full bundle and the cumulative diff. Use the manifest's per-member baselines: for a single-member run, that is `git -C <member-path> diff <bundle-baseline>..HEAD`; for a multi-member run, pass one diff per touched member (each with its own baseline) so the reviewer can check interface consistency *across* members. Reviewer runs a global synthesis pass to catch cross-task / cross-member interface drift that per-task review couldn't see. Record the integration-review path in the manifest. Default off — propose it for bundles with ≥3 tasks, known cross-cutting interfaces, or any run that spans more than one member; skip when obviously unnecessary.

8. **Integrate.** Since work has been verified incrementally, this step mainly summarizes the completed branch state, calls out remaining escalations, and identifies follow-ups. Mark the manifest `STATUS: complete`.

9. **Do not edit feature code.** As orchestrator, do not edit files in domain directories yourself. Docs, plans, manifests, and `.claude/` edits are fine.

## Run manifest

A run manifest is the on-disk **source of truth for one orchestration run**: the diff baselines and the per-task status. The orchestrator creates it at the start of engineering dispatch and updates it at every transition. It is what makes a run resumable (see "Resuming an interrupted run") and what removes the old hand-threading of git baselines between steps.

**Location:** architect path → `<bundle>/run.md` (alongside `plan.md`). Skip-architect path → `<workspace-reports>/runs/<ISO-timestamp>/run.md`, with the inline contract saved beside it as `contract.md`. (`<workspace-reports>` is `<repo>/.claude/reports` for single-repo/monorepo or `<workspace-root>/.orchestration/reports` for multi-repo.) The manifest lives in the gitignored reports tree, so it is personal and never committed.

**Format:**

```
RUN: <ISO-timestamp>
TICKET: <one-liner>
TOPOLOGY: single-repo | monorepo | multi-repo
BUNDLE: <bundle path | "inline">
STATUS: planning | executing | complete | blocked
UPDATED: <ISO-timestamp>

ACTIVE_MEMBERS:
  - <member-id>: path=<rel-path> baseline=<git sha captured at run start>

EXECUTION_ORDER: [task-01-<slug>, task-02-<slug>, ...]

TASKS:
  - id: task-NN-<slug>
    repo: <member-id>
    status: not_started | in_progress | gates_verified | awaiting_review | awaiting_verification | done | blocked
    engineer_report: <path | —>
    gates_observed: { convention: pass|fail|n/a, lint: …, test: …, build: … }   # the ORCHESTRATOR's run, not the engineer's claim
    review: <path | —>
    verdict: approve | revise | reject | —
    user_verified: yes | no
    fix_rounds: <int>

INTEGRATION_REVIEW: <path | not_run>
```

## Planning phase (architect path)

1. **Dispatch chuck-architect** with the user's request, any constraints, and the active member set (with each member's path + gate commands from the profile). Architect reads each active member, explores relevant code, decomposes the work into tasks (each assigned to a specialist *and* an `ASSIGNED_REPO` member, with order and dependencies), and writes a bundle. The bundle is workspace-level: for single-repo / monorepo it goes to `<repo>/.claude/reports/chuck-architect/<ISO-timestamp>/`; for multi-repo (parent folder, not a repo) it goes to `<workspace-root>/.orchestration/reports/chuck-architect/<ISO-timestamp>/`. Bundle contains `plan.md` (master) plus one `task-NN-<slug>.md` per task. Plan-review reports live alongside the bundle in the same workspace-level reports tree; engineer and code-review reports live in each touched member's own `reports_dir`.

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

3. **Dispatch** to the matching engineering specialist. Pass the contract inline (no bundle path, since there is no bundle), plus the `ASSIGNED_REPO` member.

4. **Run the per-task gate** exactly as in workflow step 5's per-task sub-steps: open a run manifest (skip-path location), capture the member baseline, read the report, **independently verify the gates**, dispatch `chuck-code-reviewer` for the one task, handle the verdict, and run the user verification gate. Then integrate (step 8).

This path exists for speed on clearly trivial cross-domain or single-domain work. It does NOT support multi-task dispatch — for anything with more than one task, use the architect path.

## Hard gates

Reject a specialist's report if:
- Any project-defined check (convention, lint, tests) is `fail` **as observed by the orchestrator's own independent gate run** (step 5 sub-step 3) — the engineer's self-reported `pass` does not satisfy the gate on its own; a self-report that disagrees with the observed result is itself grounds to reject
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

## Resuming an interrupted run

Work is checkpointed **on disk**, so a run can stop mid-execution (context limit, the user steps away, a crash) and resume without redoing finished work. On re-invocation, reconstruct state rather than starting over:

- **The run manifest is the primary checkpoint.** If a `run.md` exists for the run, read it: its `STATUS`, per-task `status`/`verdict`/`user_verified`, and per-member `baseline` tell you exactly where to resume and what diff baselines to use. Resume at the first task not marked `done`. Do **not** re-dispatch tasks already `done`. The manifest replaces guessing — only fall back to scanning the reports tree if no manifest exists (older runs).
- **Setup interrupted** → a leftover `workspace.*.draft` is the checkpoint. `/orchestrate-setup` resumes from it (see that command).
- **Planning interrupted** (no manifest yet — it is created at the start of engineering dispatch) → if a bundle exists but has no plan-review next to it, resume at plan review; if it has an approved review but no manifest, resume at engineering dispatch (which opens the manifest).
- **Validate against reality.** The manifest is the source of truth for *intent*, but verify the working tree matches: a task marked `done` whose diff has vanished, or a `baseline` that no longer exists, is a conflict to **surface to the user**, not to silently re-run.
- **Always re-confirm the resume point with the user** before continuing — show what the manifest says is done and where you'll pick up.

## Failure modes

- **Checks fail in a specialist's report:** specialist returns `STATUS: blocked` with details. Decide whether to redispatch with a clarified brief or surface to the user.
- **Scope violation:** revert out-of-scope files; redispatch with stricter `SCOPE_BOUNDARIES`.
- **Architect bundle rejected by user:** stop. Re-clarify with the user before re-dispatching the architect. Don't loop until you understand what changed.
- **Reviewer keeps returning `revise`:** after two rounds, escalate to the user.
- **Specialist pushes back on a task:** treat as signal. Either revise the task with the user's input, or escalate to architect for replanning.
- **Code review fails (`revise`):** identify which task(s) the critical findings are tied to, build a fix contract from the findings, re-dispatch the relevant engineer. Cap at two fix-rounds per task before escalating to user.
- **Code review rejects:** implementation needs rework that patches won't fix. Often signals a problem in the plan that wasn't caught in plan-review. Re-engage architect or surface to user — don't loop directly back to the engineer.
