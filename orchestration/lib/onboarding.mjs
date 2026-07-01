#!/usr/bin/env node
// SessionStart readiness check (the plugin's onboarding nudge).
//
// Reads the hook JSON from stdin, decides whether the open folder needs
// orchestration setup, and — only if it does AND the readiness check is enabled
// (Setting 2) — emits `additionalContext` prompting the model to OFFER setup.
// It never runs setup itself.
//
// Invariants: this fires on every qualifying session start, so it must be fast
// and must NEVER throw, block, or print an error. Any problem → exit 0 silent.
// "Ready?" is decided deterministically (profile exists AND passes the schema
// validator) — never by reading markdown.

import fs from "node:fs";
import { detectTopology } from "./detect.mjs";
import { validateWorkspace } from "./schema.mjs";
import { profilePaths } from "./paths.mjs";
import { readinessCheckEnabled } from "./config.mjs";

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}
function cwdFromInput(raw) {
  try { const j = JSON.parse(raw); if (j && typeof j.cwd === "string") return j.cwd; } catch { /* fall through */ }
  return process.cwd();
}
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}
function fileExists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}
function emit(additionalContext) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  }));
}

function memberCount(topo) {
  if (topo.topology === "multi-repo") return (topo.childRepos || []).length;
  // Workspaces/pnpm/nx/turbo/lerna monorepos report placeholder subProjects
  // ("<workspaces-field>", ...) from detectTopology, so this yields 0 there —
  // the caller's `n ? …` guard drops the count from the nudge wording (cosmetic).
  if (topo.topology === "monorepo") return (topo.subProjects || []).filter((p) => !String(p).startsWith("<")).length;
  return 1;
}

function main() {
  const cwd = cwdFromInput(readStdin());

  // Setting 2: respect the readiness-check toggle (fail-open to ON on trouble).
  if (!readinessCheckEnabled(cwd)) return;

  // Only nudge where there is actually something to orchestrate.
  const topo = detectTopology(cwd);
  if (!topo || !topo.topology) return;

  const root = topo.root || cwd;
  const { profile: profilePath, draft } = profilePaths(root, topo.topology);

  // Configured? Deterministic: the profile exists AND passes the validator.
  const profile = readJSON(profilePath);
  if (profile) {
    const { valid } = validateWorkspace({ ...profile, decisions_needed: undefined });
    if (valid) return; // ready → stay silent
  }

  const n = memberCount(topo);
  const scope = `${topo.topology}${n ? ` with ${n} member${n === 1 ? "" : "s"}` : ""}`;

  if (fileExists(draft)) {
    emit(`The orchestration plugin's readiness check found an INTERRUPTED setup in ${root} `
      + `(a workspace draft exists but no finalized profile). Suggest to the user that they resume setup by `
      + `running \`/orchestrate-config init\`, then wait for their go-ahead. Do not run it automatically.`);
    return;
  }

  emit(`The orchestration plugin's readiness check ran: ${root} has no valid orchestration workspace profile yet `
    + `(detected ${scope}). Suggest to the user that they run \`/orchestrate-config init\` to configure orchestration `
    + `for this workspace, then wait for their go-ahead. Do not run it automatically.`);
}

try { main(); } catch { /* a readiness nudge must never disturb the session */ }
process.exit(0);
