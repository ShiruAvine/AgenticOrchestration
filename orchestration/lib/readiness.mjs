#!/usr/bin/env node
// Shared readiness decision for the orchestration onboarding hooks.
//
// Single source of truth for "does this workspace still need setup?" so the
// SessionStart notice (onboarding.mjs) and the UserPromptSubmit question
// (prompt-nudge.mjs) never diverge on what counts as configured.
//
// Deterministic: "configured" ⇔ the profile file exists AND passes the schema
// validator — never decided by reading markdown. Must never throw; every caller
// is a hook that has to stay silent (and fast) on any trouble.
//
// Usage (debug): node readiness.mjs [workspace-root]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectTopology } from "./detect.mjs";
import { validateWorkspace } from "./schema.mjs";
import { profilePaths } from "./paths.mjs";

function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function fileExists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

// Members that count toward the "n members" wording. detect.mjs now enumerates
// real monorepo sub-project paths, so this is a straight count.
function memberCount(topo) {
  if (topo.topology === "multi-repo") return (topo.childRepos || []).length;
  if (topo.topology === "monorepo") return (topo.subProjects || []).length;
  return 1;
}

// Returns exactly one of:
//   { applicable: false }                                      → nothing to orchestrate here
//   { applicable: true, needsSetup: false, root }              → configured (stay silent)
//   { applicable: true, needsSetup: true, interrupted, scope, root }
export function readinessState(cwd) {
  const start = cwd || process.cwd();
  const topo = detectTopology(start);
  if (!topo || !topo.topology) return { applicable: false };

  const root = topo.root || start;
  const { profile, draft } = profilePaths(root, topo.topology);

  const n = memberCount(topo);
  const scope = `${topo.topology}${n ? ` with ${n} member${n === 1 ? "" : "s"}` : ""}`;

  const prof = readJSON(profile);
  if (prof) {
    // A profile FILE exists → the workspace IS set up. Distinguish valid from stale:
    if (validateWorkspace({ ...prof, decisions_needed: undefined }).valid) {
      return { applicable: true, needsSetup: false, root, profile };
    }
    // Present but invalid — almost always an older-plugin schema (e.g. workspace@2
    // after the @3 bump), sometimes a hand-broken file. This needs RE-DERIVING
    // (/orchestrate-config update, which rebuilds from the durable overrides), NOT a
    // fresh init. Reporting it as "no setup" is the bug this flag fixes.
    return { applicable: true, needsSetup: true, stale: true, scope, root, profile };
  }

  // No profile file at all → fresh setup (interrupted if a detached draft is present).
  return { applicable: true, needsSetup: true, interrupted: fileExists(draft), scope, root };
}

// fileURLToPath (not URL.pathname): the latter yields "/E:/..." on Windows.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.stdout.write(JSON.stringify(readinessState(process.argv[2]), null, 2) + "\n");
