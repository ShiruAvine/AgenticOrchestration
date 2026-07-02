---
description: Run a ticket through the orchestration workflow (delegate to domain specialists)
---

Use the orchestration workflow for the following ticket:

$ARGUMENTS

## What to do

1. Read `${CLAUDE_PLUGIN_ROOT}/ORCHESTRATION.md` for the full workflow, contract template, and report format. (Fallbacks if that path is unavailable: `.claude/ORCHESTRATION.md`, then `~/.claude/ORCHESTRATION.md`.)
2. **Establish the workspace (Phase 0).** Load the personal, gitignored workspace profile — read **`workspace.json`** (the source of truth, always under `./.claude/orchestration/`: `workspace.json` for multi-repo, or `workspace.local.json` for single-repo / monorepo), not the rendered `.md`. **If none exists, run `/orchestrate-config init` first** — it dispatches `orchestration-settings-manager` to detect the topology (single-repo / monorepo / multi-repo parent folder) deterministically, asks you only the crucial decisions, and derives the profile. See `${CLAUDE_PLUGIN_ROOT}/WORKSPACE.md`.
3. **Resolve this run's scope.** From the profile's members, determine which member(s) this ticket touches (one, several, or all) — by the user's statement, by inference, or by asking. Each task will carry an `ASSIGNED_REPO`. Every member is usable and all specialists are available; if a member has an unusual stack with no obvious engineer or no gates, note that when planning (the architect assigns a best-fit engineer and flags reduced confidence) rather than treating it as excluded.
4. Read each active member's `CLAUDE.md` to bind the generic specialists to that member's domain map (which specialist owns which directory, which convention checks apply, where skills live); use that member's gate commands from the profile.
5. Follow the workflow end-to-end: clarify scope → decompose (tasks tagged with `ASSIGNED_REPO`) → choose execution mode → draft per-specialist contracts → dispatch via the `Agent` tool → verify specialist reports against the hard gates → integrate and report to the user.

The user has explicitly invoked this command, so the "skip for trivial tasks" exception does not apply — orchestrate regardless of ticket size.
