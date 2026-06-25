# Agentic Orchestration

A portable [Claude Code](https://code.claude.com) plugin that turns the main session into an **orchestrator**: it gatekeeps, decomposes, dispatches work to specialist subagents, and integrates the results — instead of editing code inline.

The specialists are **project-agnostic**. They learn each project's stack, layout, conventions, and check commands at runtime by reading that project's `CLAUDE.md`. Nothing about any specific framework is baked into this plugin.

A **Phase 0 discovery step** (`/orchestrate-setup`) first figures out *what* it is pointed at — a single repo, a monorepo, or a parent folder of independent repos. A read-only analyst agent (`chuck-workspace-analyst`) does this **deterministically** from evidence on disk, drafts a **workspace profile**, and surfaces only the crucial calls for you to confirm. Every later run reads that profile, so "which repos are in scope", "where reports go", and "what the diff is" are pinned down rather than guessed. A single run can target one member or several. The profile is **personal and gitignored** — it captures how *you* drive the workspace and never gets committed.

## What's inside

This repo is a **Claude Code marketplace** (`agentic-orchestration`) hosting one **plugin** (`orchestration`):

| Component | What it is |
|-----------|-----------|
| `chuck-workspace-analyst` | Read-only Phase 0 analyst: deterministically detects topology, profiles members, drafts the workspace profile, returns only the crucial decisions. |
| `chuck-architect` | Plans and decomposes a ticket into a reviewable bundle (master plan + per-task contracts). |
| `chuck-frontend-engineer` | Implements frontend/UI tasks from a contract. |
| `chuck-backend-engineer` | Implements backend/services/API/DB tasks from a contract. |
| `chuck-plan-reviewer` | Reviews plan bundles (per-task rubric + global synthesis). |
| `chuck-code-reviewer` | Reviews completed work (per-task rubric + integration synthesis). |
| `/orchestrate-setup` | Slash command for Phase 0: detect topology, confirm with the user, write the workspace profile. |
| `/orchestrate` | Slash command to run a ticket through the full workflow. |
| `ORCHESTRATION.md` | The generic workflow, contract template, hard gates, run manifest, and resume rules. |
| `WORKSPACE.md` | Topology definitions, detection algorithm, and the workspace-profile template. |
| `plan-review-rubric`, `code-review-rubric` | Deterministic per-task review checklists. |

## Install

```text
# 1. Add this marketplace (one time, per machine)
/plugin marketplace add ShiruAvine/AgenticOrchestration

# 2. Install the plugin
/plugin install orchestration@agentic-orchestration
```

## Activate / deactivate (personal)

This is a **personal** workflow tool, so enable it for *yourself* rather than committing it to a shared repo. Put this in your user-level `~/.claude/settings.json` to turn it on everywhere:

```json
{
  "enabledPlugins": {
    "orchestration@agentic-orchestration": true
  }
}
```

Set it to `false` (or omit it) to deactivate. If you *do* want a whole team to share the same on/off state, the same key works in a project's committed `.claude/settings.json` — but the workspace profile itself always stays personal and gitignored.

## Workspaces & topologies

The orchestrator runs against a **workspace**, which is *not* assumed to be one git repo. Three topologies are supported (see `orchestration/WORKSPACE.md`):

| Topology | What it is | Profile location (personal, gitignored) |
|----------|-----------|------------------|
| `single-repo` | one repo, one project | `<repo>/.claude/orchestration/workspace.local.md` |
| `monorepo` | one repo, many sub-projects | `<repo>/.claude/orchestration/workspace.local.md` |
| `multi-repo` | a non-repo parent folder of independent repos opened together | `<workspace-root>/.orchestration/workspace.md` |

Run `/orchestrate-setup` once per workspace (or whenever it changes). It dispatches `chuck-workspace-analyst` to detect the topology and profile every member deterministically, asks you **only the crucial decisions** (ambiguous topology, out-of-scope exclusions, missing `CLAUDE.md`, ambiguous role), and writes the profile — a helper document recording each member's stack, gate commands, role, and any per-case handling (e.g. "this member has no lint script — skip that gate"). Setup also adds the `.gitignore` entries that keep the profile and reports personal. After that, `/orchestrate` reads the profile and tags each task with an `ASSIGNED_REPO`, so one run can span multiple repos when a feature crosses them.

## Wire it into a project

The plugin supplies the *generic* machinery. Each member supplies its own **domain map** — which specialist owns which directory, which framework, which convention checks and lint/test commands to run. Put that in the member's `CLAUDE.md` (or a file it imports). The specialists read it before doing any work. (`/orchestrate-setup` can scaffold a minimal one for members that lack it.)

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

Work products are written outside the plugin: plan bundles and plan/integration reviews go to the workspace-level reports tree (the repo's `.claude/reports/...`, or `<workspace-root>/.orchestration/reports/...` for a multi-repo workspace), while engineer reports and per-task code reviews go to each touched member's own `.claude/reports/...`.

## How runs are tracked & gated

Each run keeps a **run manifest** (`run.md`, in the gitignored reports tree) recording the per-member git baselines and every task's status, observed gate results, review verdict, and user verification. It is the run's source of truth: diff baselines come from it rather than being re-threaded between steps, and an interrupted run **resumes from it** — picking up at the first task not marked `done` instead of starting over.

Gates are **independently verified, not self-reported**. After an engineer returns, the orchestrator runs that member's gate commands itself and records the observed result in the manifest; the hard gate keys off the observed result, and the code reviewer cross-checks the engineer's self-report against it. An engineer claiming `pass` when the gate actually fails is caught.

## License

MIT — see [LICENSE](./LICENSE).

Published read-only. Contributions are not accepted; fork freely under the MIT terms.
