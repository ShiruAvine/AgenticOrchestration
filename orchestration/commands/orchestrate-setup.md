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
   definitions, the `lib/` tooling, the profile schema, role heuristics, and profile
   location rules. (Fallbacks: `.claude/WORKSPACE.md`, `~/.claude/WORKSPACE.md`.)

2. **Check for an existing profile or an interrupted draft.** Look under
   `./.claude/orchestration/` (`workspace.json` for multi-repo;
   `workspace.local.json` for single-repo / monorepo).
   - A finalized profile present → treat this run as a **refresh**: pass it to the
     analyst so it can diff against current state and show what changed.
   - A leftover `workspace*.json.draft` (and no finalized profile) → a prior setup was
     **interrupted**. Offer the user: **resume** from the draft (skip re-detection,
     jump straight to the remaining decisions) or **restart** fresh. Resuming is the
     default — the draft is the checkpoint.

3. **Dispatch `chuck-workspace-analyst`** via the `Agent` tool. It RUNS
   `lib/detect.mjs`, sanity-checks the JSON, writes a `workspace.json.draft`, and
   returns: the topology, the detected member table, the `decisions_needed` list
   (verbatim from the script, each with a recommended default), and proposed
   `.gitignore` actions. Do not re-do detection yourself — consume the analyst's result.

4. **Ask only the crucial decisions.** For each item in `decisions_needed`, ask the
   user via the `AskUserQuestion` tool, presenting the recommended default as the first
   option. If the list is empty, ask nothing — go straight to step 6. Typical items:
   ambiguous role, no-matching-agent disposition (exclude vs keep flagged), missing
   `CLAUDE.md` handling, an unresolved gate.

5. **Build `answers.json`** capturing the user's choices, keyed by member id, e.g.
   `{ "members": { "<id>": { "role": "...", "role_reason": "...", "gates": {...},
   "note": "..." } } }`. For a missing `CLAUDE.md`: *generate* → create a minimal
   domain-map `CLAUDE.md` in that member and add a `note`; *reduced context* → add a
   `note` only; *exclude* → set `"exclude": true`.

6. **Finalize via the scripts** (do not hand-write the profile):
   ```
   node ${CLAUDE_PLUGIN_ROOT}/lib/profile.mjs finalize <draft.json> <answers.json> --out <profile.json>
   node ${CLAUDE_PLUGIN_ROOT}/lib/profile.mjs render   <profile.json>               --out <profile.md>
   ```
   `finalize` applies the answers and **re-validates against the schema** (it fails
   loudly on any bad/unknown answer). Write `workspace.json` (+ rendered `.md`) to the
   topology's location, then delete the `.draft` — **only on successful finalize**, so
   an interrupted run can still resume from the draft.

7. **Apply the gitignore actions.** Add the analyst's proposed entries so nothing
   personal gets committed:
   - single-repo / monorepo: add `.claude/orchestration/*.local.*` and
     `.claude/reports/` to the repo's `.gitignore`.
   - multi-repo: the parent's `.claude/` is un-tracked already (non-repo root); add
     `.claude/reports/` to each in-scope **member** repo's `.gitignore`.

8. **Report back** to the user: the topology, the in-scope member table (id · path ·
   stack · gates · role), anything excluded and why, the gitignore entries added, and
   the profile path. Note they can re-run `/orchestrate-setup` whenever the workspace
   changes.

This command only writes your personal profile (`workspace.json` + rendered `.md`),
optional minimal `CLAUDE.md` files, and `.gitignore` entries. It does not plan or
implement anything — that is `/orchestrate`.
