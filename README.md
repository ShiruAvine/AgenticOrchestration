# Agentic Orchestration

A portable [Claude Code](https://code.claude.com) plugin that turns the main session into an **orchestrator**: it gatekeeps, decomposes, dispatches work to specialist subagents, and integrates the results — instead of editing code inline.

The specialists are **project-agnostic**. They learn each project's stack, layout, conventions, and check commands at runtime by reading that project's `CLAUDE.md`. Nothing about any specific framework is baked into this plugin.

## What's inside

This repo is a **Claude Code marketplace** (`agentic-orchestration`) hosting one **plugin** (`orchestration`):

| Component | What it is |
|-----------|-----------|
| `chuck-architect` | Plans and decomposes a ticket into a reviewable bundle (master plan + per-task contracts). |
| `chuck-frontend-engineer` | Implements frontend/UI tasks from a contract. |
| `chuck-backend-engineer` | Implements backend/services/API/DB tasks from a contract. |
| `chuck-plan-reviewer` | Reviews plan bundles (per-task rubric + global synthesis). |
| `chuck-code-reviewer` | Reviews completed work (per-task rubric + integration synthesis). |
| `/orchestrate` | Slash command to run a ticket through the full workflow. |
| `ORCHESTRATION.md` | The generic workflow, contract template, and hard gates. |
| `plan-review-rubric`, `code-review-rubric` | Deterministic per-task review checklists. |

## Install

```text
# 1. Add this marketplace (one time, per machine)
/plugin marketplace add ShiruAvine/AgenticOrchestration

# 2. Install the plugin
/plugin install orchestration@agentic-orchestration
```

## Activate / deactivate per project

Enablement is a committable setting, so the whole team shares the same on/off state. In a project's `.claude/settings.json`:

```json
{
  "enabledPlugins": {
    "orchestration@agentic-orchestration": true
  }
}
```

Set it to `false` (or omit it) to deactivate orchestration for that project. You can also enable it globally for every project via `~/.claude/settings.json`.

## Wire it into a project

The plugin supplies the *generic* machinery. Each project supplies its own **domain map** — which specialist owns which directory, which framework, which convention checks and lint/test commands to run. Put that in the project's `CLAUDE.md` (or a file it imports). The specialists read it before doing any work.

A minimal project `CLAUDE.md` section looks like:

```markdown
# Project Domain Map

## Frontend
- Codebase: `<dir>/`
- Framework: <framework + conventions>
- Convention check: <how to validate changed files>
- Lint / tests: <commands>

## Backend
- Codebase: `<dir>/`
- Framework: <framework + conventions>
- Convention check: <how to validate changed files>
- Lint / tests: <commands>
```

Work products (plan bundles, reports, reviews) are written under the **project's** `.claude/reports/...`, not into the plugin.

## License

MIT — see [LICENSE](./LICENSE).

Published read-only. Contributions are not accepted; fork freely under the MIT terms.
