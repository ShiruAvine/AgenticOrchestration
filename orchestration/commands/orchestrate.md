---
description: Run a ticket through the orchestration workflow (delegate to domain specialists)
---

Use the orchestration workflow for the following ticket:

$ARGUMENTS

## What to do

1. Read `${CLAUDE_PLUGIN_ROOT}/ORCHESTRATION.md` for the full workflow, contract template, and report format. (Fallbacks if that path is unavailable: `.claude/ORCHESTRATION.md`, then `~/.claude/ORCHESTRATION.md`.)
2. **Establish the workspace (Phase 0).** Load the personal, gitignored workspace profile (`./.orchestration/workspace.md` for multi-repo, or `./.claude/orchestration/workspace.local.md` for single-repo / monorepo). **If none exists, run `/orchestrate-setup` first** — it dispatches `chuck-workspace-analyst` to detect the topology (single-repo / monorepo / multi-repo parent folder) deterministically, asks you only the crucial decisions, and writes the profile. See `${CLAUDE_PLUGIN_ROOT}/WORKSPACE.md`.
3. **Resolve this run's scope.** From the profile's in-scope members, determine which member(s) this ticket touches (one, several, or all) — by the user's statement, by inference, or by asking. Each task will carry an `ASSIGNED_REPO`.
4. Read each active member's `CLAUDE.md` to bind the generic specialists to that member's domain map (which specialist owns which directory, which convention checks apply, where skills live); use that member's gate commands from the profile.
5. Follow the workflow end-to-end: clarify scope → decompose (tasks tagged with `ASSIGNED_REPO`) → choose execution mode → draft per-specialist contracts → dispatch via the `Agent` tool → verify specialist reports against the hard gates → integrate and report to the user.

The user has explicitly invoked this command, so the "skip for trivial tasks" exception does not apply — orchestrate regardless of ticket size.
