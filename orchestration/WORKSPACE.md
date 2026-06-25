# Workspace Model

The orchestration workflow runs against a **workspace**. A workspace is whatever
the orchestrator is pointed at when a ticket comes in — it is *not* assumed to be
a single git repository. This file defines the topologies the plugin supports,
how to detect them, and the **workspace profile** that records the answers so every
later run is fast and deterministic.

Read this file during **Phase 0** of `ORCHESTRATION.md`. The `chuck-workspace-analyst`
agent does the deterministic detection + drafting described here; the
`/orchestrate-setup` command dispatches that agent, asks the user only the crucial
decisions it returns, and writes the profile; `/orchestrate` reads the profile (or
triggers setup if it is missing).

## Personal, not shared

The workspace profile is a **personal** artifact — it captures how *you* drive this
workspace, and it must never be committed to a shared repo. Setup therefore writes
it to a gitignored location and adds the necessary `.gitignore` entries:

- **single-repo / monorepo:** `<repo>/.claude/orchestration/workspace.local.md`
  (the `.local.md` suffix marks it personal; setup adds it + `.claude/reports/` to
  the repo's `.gitignore`).
- **multi-repo:** `<workspace-root>/.orchestration/workspace.md` (the parent folder
  is not a repo, so it is inherently un-shared; setup still adds `.claude/reports/`
  to each in-scope **member** repo's `.gitignore`, since engineer/review reports
  land there).

Plugin **enablement** is likewise best kept personal: enable orchestration in your
user-level `~/.claude/settings.json` rather than committing it to a project's
`.claude/settings.json`.

## Why this exists

The specialists bind to a project via its `CLAUDE.md`. But "the project" is
ambiguous: it might be one repo, one repo with many packages, or a folder of
many independent repos opened together. Each shape changes three concrete things:

- **Where `CLAUDE.md` lives** (one root vs. one per member).
- **Where work products go** (`.claude/reports/...` of *which* repo?).
- **What "the diff" is** (one `git diff` vs. one per member, with per-member baselines).

Guessing these per run is where the generic workflow used to drift. The workspace
profile pins them down once, with the user's confirmation.

## Topologies

### `single-repo`
The current working directory is inside one git repository, and that repository
is a single project (one `CLAUDE.md`, one package/module tree).

- **Members:** one — the repo itself.
- **Profile location:** `<repo>/.claude/orchestration/workspace.local.md` (gitignored)
- **Reports:** `<repo>/.claude/reports/...` (gitignored)
- **Diff baseline:** one, in that repo.

### `monorepo`
The working directory is inside one git repository that contains **multiple
sub-projects** (packages / apps / services), e.g. detected via a `workspaces`
field, multiple `package.json`/`pyproject.toml`, or multiple nested `CLAUDE.md`.

- **Members:** each sub-project the user marks in scope.
- **Profile location:** `<repo>/.claude/orchestration/workspace.local.md` (gitignored)
- **Reports:** `<repo>/.claude/reports/...` (gitignored; single reports tree; tag entries by member).
- **Diff baseline:** one repo, but per-member diffs are scoped by member path
  (`git diff <baseline> -- <member-path>`).

### `multi-repo` (parent / workspace folder)
The working directory is **not** a git repository; its immediate children include
two or more independent git repositories opened together (the "parent folder"
workflow). Each member repo is autonomous — its own history, branch, `CLAUDE.md`,
and `.claude/`.

- **Members:** each child repo the user marks in scope.
- **Profile location:** `<workspace-root>/.orchestration/workspace.md`
  (the parent is not a repo, so the profile lives in a plain folder at the root and
  is inherently un-shared).
- **Reports:** each member writes to **its own** `<member>/.claude/reports/...`
  (setup gitignores that path in each in-scope member).
- **Diff baseline:** one **per member**, in that member's repo.

## Setup flow

Phase 0 is deterministic-first, human-light:

1. **`/orchestrate-setup` dispatches `chuck-workspace-analyst`** — a read-only agent
   that runs the detection below as concrete commands, profiles every member, drafts
   the full profile to a `.draft` file, and returns the draft path plus a short
   `DECISIONS NEEDED` list (crucial items only) and proposed `.gitignore` actions.
2. **The command asks the user only the crucial decisions** (via `AskUserQuestion`),
   each pre-filled with the analyst's recommended default.
3. **The command finalizes** — applies the answers, applies the `.gitignore` actions,
   promotes `.draft` to the real profile, and reports the result.

## Detection algorithm (deterministic)

Every conclusion must come from a command output or a file read — never a guess. If
evidence is insufficient for a field, it becomes a `DECISIONS NEEDED` item, not an
invented value.

1. **Topology.** `git rev-parse --is-inside-work-tree` in the cwd.
   - **true** → `single-repo` or `monorepo`. From `git rev-parse --show-toplevel`,
     count distinct sub-project markers (a `workspaces` field in root `package.json`;
     `pnpm-workspace.yaml`; `nx.json`/`turbo.json`/`lerna.json`; or >1
     `package.json`/`pyproject.toml`/`go.mod` in distinct subdirs, excluding
     `node_modules`/`vendor`/`dist`/`build`). >1 → `monorepo`; else `single-repo`.
   - **false/error** → scan immediate children (`for d in */; do [ -d "$d/.git" ] && echo "$d"; done`).
     ≥1 child repo → `multi-repo`; 0 → nothing to orchestrate (block; ask where code lives).

2. **Per-member facts** (commands, not guesses):
   - `path` (relative to workspace root; `.` for single-repo)
   - `git` + `default_branch` (`git -C <path> symbolic-ref --short HEAD`)
   - `stack` (read `package.json` deps, `pyproject.toml`/`requirements.txt`,
     `go.mod`, `pom.xml`, `Cargo.toml`, Dockerfiles/`docker-compose*.yml`)
   - `claude_md` present? (absent is allowed but flagged — gates will be weaker)
   - `gates` from `package.json` scripts (`lint`/`test`/`test:e2e`/`build`/`typecheck`,
     exact command strings) or the stack equivalent. No script → `none` (never fabricate).

3. **Role classification (heuristic table).**

   | Evidence on disk | Role |
   |------------------|------|
   | react / angular / vue / svelte / next / vite-UI deps | `chuck-frontend-engineer` |
   | nest / express / fastify / koa / hapi; or Python/Go/Java web frameworks | `chuck-backend-engineer` |
   | both frontend **and** backend deps present | ambiguous → `DECISIONS NEEDED` (default `chuck-backend-engineer`) |
   | only notebooks/data/ML artifacts (`.ipynb`, data dirs, no service entrypoint) | `out-of-scope: research` |
   | only infra (`docker-compose*.yml`, `db/`, k8s, terraform; no app code) | `out-of-scope: infra` |

4. Draft the profile and surface decisions per the rules below.

## Crucial decisions only

The analyst raises a decision **only** when evidence is genuinely insufficient or the
choice is consequential and not inferable. Everything detection settles is recorded in
the draft as a default the user can simply accept — it is *not* asked.

Raise a decision for:
- **Ambiguous topology** (e.g. a repo that is both an app and a set of packages).
- **Out-of-scope exclusions** — confirm each member classified `out-of-scope`.
- **Missing `CLAUDE.md`** — generate a minimal one / proceed with reduced gates / exclude.
- **Ambiguous role** (frontend + backend both present).
- **Unresolved gate** for an in-scope member (e.g. no detectable test command).

Do NOT ask about: detected stack, detected branch, gate commands that were found,
profile/report locations, or the standard defaults below (record them, let the user
override later if they care).

Recorded defaults (not asked): architect default-on; parallelism opt-in;
human-gate cadence per-task.

Per-run, in addition: **which members does *this ticket* touch?** The profile is
the persistent registry; scope is chosen per execution (one, some, or all members).

## Workspace profile format

Write this to the profile location for the topology. It is the helper document:
it tells any future run exactly how this workspace is wired and how to run it.

```
# Orchestration Workspace Profile
GENERATED: <ISO-8601> by /orchestrate-setup
TOPOLOGY: single-repo | monorepo | multi-repo
WORKSPACE_ROOT: <absolute path>
PROFILE_LOCATION: <path to this file>

## Members
- id: <slug>
  path: <relative to WORKSPACE_ROOT>            # "." for single-repo
  git: <true|false>   default_branch: <branch>
  stack: <e.g. NestJS/TS | Express/TS | Python | infra>
  claude_md: <present | absent>                  # if absent, note the consequence
  role: <chuck-backend-engineer | chuck-frontend-engineer | out-of-scope: <reason>>
  gates:
    convention: <command | none>
    lint: <command | none>
    test: <command | none>
    build: <command | none>
  reports_dir: <path where this member's reports go>
  notes: <per-member gotchas the specialists must respect>

## Active roles
<list of chuck-* engineer roles live in this workspace; others are dormant>

## Defaults
architect: default-on | per-ticket-ask
parallelism: opt-in | auto-when-independent
human_gate: per-task | per-bundle

## Per-case handling
| Case | Rule |
|------|------|
| <member or situation> | <what the workflow does about it> |

## How to run
<concrete, copy-pasteable invocation notes for THIS workspace — which directory to
invoke from, how scope is chosen per run, anything non-obvious.>
```

## Per-run scope resolution

Once the profile exists, each `/orchestrate` invocation:

1. Loads the profile.
2. Determines the **active member set** for this ticket — by explicit user
   statement ("work on predictions-api"), by inference from the ticket, or by
   asking. The set may be one member, several, or all in-scope members.
3. Passes each task an `ASSIGNED_REPO` = the member `id` it belongs to. For
   `single-repo` this is always the one member and can be omitted.

## How `ASSIGNED_REPO` flows

- **chuck-architect** sets `ASSIGNED_REPO` on every task contract (the member the
  task lives in) and may produce a plan whose tasks span multiple members.
- **engineers** operate **inside** their task's `ASSIGNED_REPO` member: they read
  *that member's* `CLAUDE.md`, edit only within that member's path, and run *that
  member's* gate commands from the profile. Write the report to that member's
  `reports_dir`.
- **reviewers** scope the diff to the task's member with that member's baseline
  (`git -C <member-path> diff <baseline>..HEAD -- <files>`), and for cross-member
  bundles check interface consistency *across* members during global synthesis.

## Profile freshness

A profile is a cache of a moving target (branches change, scripts change, repos get
added). On each `/orchestrate`, if the member set or branches visibly drifted from
the profile, note it and offer to re-run `/orchestrate-setup`. Treat a recalled
profile as "true when written" — re-verify a gate command before relying on it if
anything looks stale.
