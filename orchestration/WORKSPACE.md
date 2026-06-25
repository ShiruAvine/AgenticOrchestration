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

- **single-repo / monorepo:** `<repo>/.claude/orchestration/workspace.local.json`
  (source of truth) plus a generated `workspace.local.md` view. The `.local.*` suffix
  marks them personal; setup adds `.claude/orchestration/*.local.*` + `.claude/reports/`
  to the repo's `.gitignore`.
- **multi-repo:** `<workspace-root>/.orchestration/workspace.json` (source of truth)
  plus a generated `workspace.md` view. The parent folder is not a repo, so it is
  inherently un-shared; setup still adds `.claude/reports/` to each in-scope **member**
  repo's `.gitignore`, since engineer/review reports land there.

The **`.json` is the machine source of truth** that every later step reads; the `.md`
is a human-readable view rendered from it by `lib/profile.mjs`. Never parse the `.md`.

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
- **Profile location:** `<repo>/.claude/orchestration/workspace.local.json` (+ rendered `.md`; gitignored)
- **Reports:** `<repo>/.claude/reports/...` (gitignored)
- **Diff baseline:** one, in that repo.

### `monorepo`
The working directory is inside one git repository that contains **multiple
sub-projects** (packages / apps / services), e.g. detected via a `workspaces`
field, multiple `package.json`/`pyproject.toml`, or multiple nested `CLAUDE.md`.

- **Members:** each sub-project the user marks in scope.
- **Profile location:** `<repo>/.claude/orchestration/workspace.local.json` (+ rendered `.md`; gitignored)
- **Reports:** `<repo>/.claude/reports/...` (gitignored; single reports tree; tag entries by member).
- **Diff baseline:** one repo, but per-member diffs are scoped by member path
  (`git diff <baseline> -- <member-path>`).

### `multi-repo` (parent / workspace folder)
The working directory is **not** a git repository; its immediate children include
two or more independent git repositories opened together (the "parent folder"
workflow). Each member repo is autonomous — its own history, branch, `CLAUDE.md`,
and `.claude/`.

- **Members:** each child repo the user marks in scope.
- **Profile location:** `<workspace-root>/.orchestration/workspace.json` (+ rendered `.md`)
  (the parent is not a repo, so the profile lives in a plain folder at the root and
  is inherently un-shared).
- **Reports:** each member writes to **its own** `<member>/.claude/reports/...`
  (setup gitignores that path in each in-scope member).
- **Diff baseline:** one **per member**, in that member's repo.

## Tooling (`lib/`)

The mechanical work is **code**, not prose-the-LLM-interprets. These zero-dependency
node scripts under `${CLAUDE_PLUGIN_ROOT}/lib/` are the deterministic substrate:

- **`detect.mjs`** — runs the detection algorithm; emits a `workspace@1` JSON object
  (facts + `decisions_needed`) on stdout. `node detect.mjs [root]`.
- **`profile.mjs`** — `validate <json>` (schema check), `finalize <detected.json>
  <answers.json>` (apply the user's decision answers deterministically, then
  re-validate), `render <json>` (emit the human `.md` view).
- **`schema.mjs`** — the validators (the single definition of both data shapes).
- **`manifest.mjs` / `gates.mjs`** — run-time substrate (see `ORCHESTRATION.md`).

The LLM's job shrinks to judgment: ask the crucial decisions, write a small
`answers.json`, and let the scripts produce and validate the profile.

## Setup flow

Phase 0 is deterministic-first, human-light:

1. **`/orchestrate-setup` dispatches `chuck-workspace-analyst`** — a read-only agent
   that RUNS `lib/detect.mjs`, sanity-checks the JSON, writes it to a
   `workspace.json.draft`, and returns the draft path, the members table, the
   `decisions_needed` list (crucial items only), and proposed `.gitignore` actions.
2. **The command asks the user only the crucial decisions** (via `AskUserQuestion`),
   each pre-filled with the script's recommended default.
3. **The command finalizes** — writes a small `answers.json`, runs
   `lib/profile.mjs finalize` (which applies answers + validates) then `render`,
   applies the `.gitignore` actions, promotes the draft to `workspace.json` (+ `.md`),
   and reports the result.

## Detection algorithm (deterministic)

**This algorithm is implemented as code in `lib/detect.mjs` and executed — it is no
longer interpreted prose.** `chuck-workspace-analyst` RUNS the script
(`node ${CLAUDE_PLUGIN_ROOT}/lib/detect.mjs <root>`) and consumes its JSON output;
the steps below are that script's **specification** (and the fallback if node is
unavailable). The script emits a `workspace@1` object with `decisions_needed`
populated; it never guesses — insufficient evidence becomes a decision, not a value.

Every conclusion must come from a command output or a file read — never a guess. If
evidence is insufficient for a field, it becomes a `decisions_needed` item, not an
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
   | only notebooks/data/ML artifacts (`.ipynb`, data dirs, no service entrypoint) | no matching agent → `DECISIONS NEEDED` (default `out-of-scope: research`) |
   | only infra (`docker-compose*.yml`, `db/`, k8s, terraform; no app code) | no matching agent → `DECISIONS NEEDED` (default `out-of-scope: infra`) |
   | any other stack with **no active `chuck-*` role that fits** (e.g. Go/Rust/data when no such engineer is active) | no matching agent → `DECISIONS NEEDED` (default `out-of-scope: <reason>`) |

   **No-matching-agent disposition.** When a member's stack maps to no active
   specialist role, the default recommendation is `out-of-scope: <reason>`, but the
   user may instead choose to **keep it in scope, flagged** — recorded as
   `in-scope: no-matching-agent (<reason>)`. A flagged member is tracked in the
   registry and may be the target of a ticket, but it has no specialist to implement
   work and usually no gates; `/orchestrate` must surface that flag before assigning
   work against it (see "Members with no matching agent" below).

4. Draft the profile and surface decisions per the rules below.

## Crucial decisions only

The analyst raises a decision **only** when evidence is genuinely insufficient or the
choice is consequential and not inferable. Everything detection settles is recorded in
the draft as a default the user can simply accept — it is *not* asked.

Raise a decision for:
- **Ambiguous topology** (e.g. a repo that is both an app and a set of packages).
- **No matching agent** — a member whose stack fits no active specialist role
  (research/ML, infra, or any unsupported stack). Confirm its disposition: exclude
  (`out-of-scope: <reason>`, the default) **or** keep it in scope flagged
  (`in-scope: no-matching-agent (<reason>)`).
- **Missing `CLAUDE.md`** — generate a minimal one / proceed with reduced context / exclude.
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

The profile is **`workspace.json`** — schema `orchestration/workspace@1`, the exact
shape `lib/schema.mjs` validates and `lib/detect.mjs` emits. It is the single source
of truth every later step reads. A human-readable `workspace.md` is **rendered from
it** by `lib/profile.mjs render`; do not hand-edit the `.md`, and do not parse it
programmatically.

```jsonc
{
  "schema": "orchestration/workspace@1",
  "generated": "<ISO-8601>",
  "topology": "single-repo | monorepo | multi-repo",
  "workspace_root": "<absolute path>",
  "members": [{
    "id": "<slug>",
    "path": "<relative to workspace_root; '.' for single-repo>",
    "git": true,
    "default_branch": "<branch | null>",
    "stack": "<e.g. NestJS/TS | Express/TS | Python | infra (docker-compose)>",
    "claude_md": "present | absent",
    "role": "chuck-backend-engineer | chuck-frontend-engineer | in-scope:no-matching-agent | out-of-scope",
    "role_reason": "<required when role is in-scope:no-matching-agent or out-of-scope>",
    "gates": { "convention": "<cmd|null>", "lint": "<cmd|null>",
               "test": "<cmd|null>", "build": "<cmd|null>" },   // null = no gate (never fabricated)
    "reports_dir": "<path where this member's reports go>",
    "notes": ["<detected per-member gotcha>", "..."]
  }],
  "decisions_needed": [{ "member": "<id>", "question": "<...>", "recommended": "<default>", "options": ["..."] }],
  "defaults": { "architect": "default-on", "parallelism": "opt-in", "human_gate": "per-task" }
}
```

`decisions_needed` is populated by detection and emptied at finalize (once the user's
answers are applied via `lib/profile.mjs finalize`). The rendered `.md` derives
`Active roles`, `Per-case handling` (from member `notes` + flagged roles), and
`How to run` automatically — they are not stored.

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

## Members with no matching agent

Some members are worth tracking in the registry even though no active specialist role
fits their stack (Python ML/data research, pure infra/compose, an unsupported
language). The user may keep these **in scope, flagged** rather than excluding them
(`role: in-scope: no-matching-agent (<reason>)`). Such a member:

- **is a valid ticket target** — it appears in per-run scope resolution like any other;
- **has no implementing specialist** and usually **no gates** (`none` across the board);
- **must be flagged before work is assigned.** When a run's scope includes a flagged
  member, `/orchestrate` states up front that no `chuck-*` role fits it and no gates
  exist to verify changes, and asks the user how to proceed (handle it manually, assign
  the closest engineer as a best-effort with reduced confidence, or drop it from this
  run) rather than silently assigning a specialist that does not fit.

Record the flag and this handling in the profile's `Per-case handling` table so every
later run inherits it.

## Profile freshness

A profile is a cache of a moving target (branches change, scripts change, repos get
added). On each `/orchestrate`, if the member set or branches visibly drifted from
the profile, note it and offer to re-run `/orchestrate-setup`. Treat a recalled
profile as "true when written" — re-verify a gate command before relying on it if
anything looks stale.
