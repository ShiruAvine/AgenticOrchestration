---
description: Run a ticket through the orchestration workflow (delegate to domain specialists)
---

Use the orchestration workflow for the following ticket:

$ARGUMENTS

## What to do

1. Read `${CLAUDE_PLUGIN_ROOT}/ORCHESTRATION.md` for the full workflow, contract template, and report format. (Fallbacks if that path is unavailable: `.claude/ORCHESTRATION.md`, then `~/.claude/ORCHESTRATION.md`.)
2. Read the project's `CLAUDE.md` to bind the generic specialists to this project's domain map (which specialist owns which directory, which convention checks apply, where skills live).
3. Follow the workflow end-to-end: clarify scope → decompose → choose execution mode → draft per-specialist contracts → dispatch via the `Agent` tool → verify specialist reports against the hard gates → integrate and report to the user.

The user has explicitly invoked this command, so the "skip for trivial tasks" exception does not apply — orchestrate regardless of ticket size.
