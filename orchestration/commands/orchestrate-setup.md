---
description: Detect the workspace topology with an analyst agent, confirm only the crucial calls, and write your personal orchestration workspace profile
---

Set up (or refresh) the **personal** orchestration workspace profile. This is the
discovery step that makes `/orchestrate` deterministic: it learns whether you are in
a single repo, a monorepo, or a parent folder of independent repos, records each
member's stack and gate commands, and writes a gitignored helper document the later
runs read. The heavy analysis is done by an agent; you only confirm the few calls
that genuinely need a human.

$ARGUMENTS

## What to do

1. **Read the model.** Read `${CLAUDE_PLUGIN_ROOT}/WORKSPACE.md` for the topology
   definitions, detection algorithm, role heuristics, profile location rules, and
   the profile template. (Fallbacks: `.claude/WORKSPACE.md`, `~/.claude/WORKSPACE.md`.)

2. **Check for an existing profile or an interrupted draft.** Look at the profile
   locations (`./.orchestration/workspace.md` for multi-repo;
   `./.claude/orchestration/workspace.local.md` for single-repo / monorepo).
   - A finalized profile present → treat this run as a **refresh**: pass it to the
     analyst so it can diff against current state and show what changed.
   - A leftover `.draft` present (and no finalized profile) → a prior setup was
     **interrupted**. Offer the user: **resume** from the draft (skip re-detection,
     jump straight to the remaining decisions) or **restart** fresh. Resuming is the
     default — the draft is the checkpoint.

3. **Dispatch `chuck-workspace-analyst`** via the `Agent` tool. It runs the
   deterministic detection, profiles every member, writes a `.draft` profile, and
   returns: the topology, the detected member table, a `DECISIONS NEEDED` list
   (crucial items only, each with a recommended default), and proposed `.gitignore`
   actions. Do not re-do the detection yourself — consume the analyst's result.

4. **Ask only the crucial decisions.** For each item in `DECISIONS NEEDED`, ask the
   user via the `AskUserQuestion` tool, presenting the analyst's recommended default
   as the first option. If the list is empty, ask nothing — go straight to step 6.
   Typical crucial items: ambiguous topology, out-of-scope exclusions, missing
   `CLAUDE.md` handling, ambiguous role, an unresolved gate command.

5. **Handle missing `CLAUDE.md`** per the user's choice: generate a minimal
   domain-map `CLAUDE.md` in that member, proceed with reduced gates (record it under
   `Per-case handling`), or mark the member out-of-scope.

6. **Finalize the profile.** Apply the user's answers to the analyst's draft and
   promote it from `.draft` to the real profile at the topology's location, then
   delete the `.draft`. Keep it **personal**: it must be gitignored. Remove the
   `.draft` **only on successful finalize** — if the run is interrupted before this
   step, leave the draft in place so the next `/orchestrate-setup` can resume from it.

7. **Apply the gitignore actions.** Add the analyst's proposed entries so nothing
   personal gets committed:
   - single-repo / monorepo: add `.claude/orchestration/*.local.md` and
     `.claude/reports/` to the repo's `.gitignore`.
   - multi-repo: the parent's `.orchestration/` is un-tracked already; add
     `.claude/reports/` to each in-scope **member** repo's `.gitignore`.

8. **Report back** to the user: the topology, the in-scope member table (id · path ·
   stack · gates · role), anything excluded and why, the gitignore entries added, and
   the profile path. Note they can re-run `/orchestrate-setup` whenever the workspace
   changes.

This command only writes your personal profile, optional minimal `CLAUDE.md` files,
and `.gitignore` entries. It does not plan or implement anything — that is `/orchestrate`.
