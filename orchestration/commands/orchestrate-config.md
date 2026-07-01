---
description: Set up and manage your personal orchestration workspace config — detect the workspace (init), inspect it (show), change it through guided menus (set), or re-detect and reconcile (update)
---

Manage the **personal, gitignored** orchestration configuration for the current
workspace. The action is:

$ARGUMENTS

If no action is given, default to `show` (and, if there is no profile yet, offer
`init`). Valid actions: **`show` · `set` · `init` · `update`** (there is no `reset` —
the config is personal/gitignored, so there is nothing canonical to reset to).

## Model (read this first)

- The mechanical work is **code** in `${CLAUDE_PLUGIN_ROOT}/lib/`. You (the main
  session) own **user interaction**; the scripts own every read/write/validate.
- **Provenance:** detected facts are re-derivable from disk and never durable. The only
  durable human artifact is **`overrides.local.json`**. The profile
  (`workspace.json` / `workspace.local.json`) is **derived = detected ⊕ overrides** and
  is regenerated — never hand-edited.
- Two config surfaces: **plugin settings** (`config.mjs`, e.g. `readiness_check`) and
  **profile overrides** (`overrides.mjs`). `set` routes to the right one.
- Resolve file locations with `node ${CLAUDE_PLUGIN_ROOT}/lib/paths.mjs <root> <topology>`
  — never hand-derive them. See `${CLAUDE_PLUGIN_ROOT}/WORKSPACE.md`.
- **Settings are session-scoped:** they are read once at session start. If the user
  changes one now, tell them it takes effect **in a new session** — it is not applied
  live.

---

## `init` — first-time setup (or full refresh)

1. **Dispatch `orchestration-settings-manager`** (Agent tool, MODE: init) against the
   workspace root. It runs `detect.mjs`, sanity-checks, writes the detected **draft**,
   and returns the members table, `DECISIONS NEEDED`, and proposed gitignore actions.
   Do not detect yourself — consume its report. (If a draft + partial
   `overrides.local.json` already exist, it reports which decisions are already answered
   so you only ask the rest.)
2. **Ask only the crucial decisions** via `AskUserQuestion`, one per `DECISIONS NEEDED`
   item, presenting the recommended default first. If the list is empty, ask nothing.
3. **Seed `overrides.local.json`** from the answers using the deterministic writer, one
   resolved call per decision:
   ```
   node ${CLAUDE_PLUGIN_ROOT}/lib/overrides.mjs set <overrides> <member> <field> <value>
   ```
   (`field` ∈ `role` | `role_reason` | `gates.<key>` | `knowledge.<slot>` |
   `knowledge.extra.<name>` | `note`.) Only record answers that differ from the detected
   default — an accepted default needs no override.
4. **Derive + render the profile:**
   ```
   node ${CLAUDE_PLUGIN_ROOT}/lib/overrides.mjs apply <draft> <overrides> --out <profile>
   node ${CLAUDE_PLUGIN_ROOT}/lib/profile.mjs render <profile> --out <rendered.md>
   ```
5. **Apply the gitignore actions**, then **delete the draft** (only after a successful
   derive, so an interrupted run can still resume from it).
6. **Report:** topology, in-scope members (id · path · stack · gates · role · knowledge),
   anything excluded/flagged and why, the gitignore entries added, and the profile path.

## `update` — re-detect an existing workspace

1. **Dispatch `orchestration-settings-manager`** (MODE: update). It re-detects, applies
   the existing overrides, and returns the derived-profile path, a **DRIFT** summary,
   any **CONFLICTS** (stale overrides), and any new `DECISIONS NEEDED`.
2. **Surface the drift** to the user (new/removed members, changed gates/branches,
   knowledge links gained/lost). Ask any new decisions via `AskUserQuestion`.
3. **Resolve conflicts** — for each stale override, ask whether to drop it
   (`overrides.mjs unset <overrides> <member> <field>`) or keep it (e.g. the member is
   temporarily gone). Never silently discard a user override.
4. **Re-derive + render** (`overrides.mjs apply` → `profile.mjs render`) and write the
   profile. Report what changed.

## `set` — change config through guided menus (no hand-typed paths)

Do **not** ask the user to type a dotted path. Read the live profile and walk them
through it:

1. Load the current profile (`workspace.json` / `.local.json`) so you present **real**
   members and their current values. If none exists, offer `init` instead.
2. **Menu 1 — target surface:** a **plugin setting** (`readiness_check`) or a
   **profile field** (per member). `AskUserQuestion`.
3. **If a setting:** ask the value; write with
   `node ${CLAUDE_PLUGIN_ROOT}/lib/config.mjs set <global|workspace> <key> <value>`
   (ask global vs this-workspace). Remind the user it applies in a new session.
4. **If a profile field:**
   - **Menu 2 — member:** pick from the real members.
   - **Menu 3 — what to set:** `role` · a knowledge slot (`claude_md` / `skills` /
     `rubrics`) · add/edit a custom **extra** link · a `gate` · append a `note`.
   - **Value step (contextual):** `role` → pick from the valid roles; a slot/gate/link
     path → ask the path and **offer to check it exists on disk** (Glob/Read); an
     `extra` link → ask the link **name** then the path.
   - **Write** via the deterministic writer:
     `node ${CLAUDE_PLUGIN_ROOT}/lib/overrides.mjs set <overrides> <member> <field> <value>`
     (resolve `<field>` yourself from the menu choices — the user never types it).
   - **Re-derive + render** so the change lands in the profile:
     `overrides.mjs apply <detected/draft> <overrides> --out <profile>` then
     `profile.mjs render`. If no current detected file is handy, re-run `detect.mjs`.
5. **Confirm** the resolved change back to the user.

## `show` — inspect current config

Render, don't hand-summarize:
- `node ${CLAUDE_PLUGIN_ROOT}/lib/profile.mjs render <profile>` — the workspace profile.
- `node ${CLAUDE_PLUGIN_ROOT}/lib/config.mjs show <root>` — effective settings + sources.
- `node ${CLAUDE_PLUGIN_ROOT}/lib/overrides.mjs show <overrides>` — the durable overrides.

If there is no profile, say so and offer `init`.

---

This command writes only your **personal** config (`overrides.local.json`, the derived
`workspace.json`/`.local.json` + rendered `.md`, plugin config files) and `.gitignore`
entries. It does not plan or implement anything — that is `/orchestrate`.
