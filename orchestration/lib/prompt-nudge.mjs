#!/usr/bin/env node
// UserPromptSubmit onboarding QUESTION — the interactive layer.
//
// On the FIRST prompt of a session where the open workspace isn't configured,
// inject an imperative directive so the model presents the user a direct,
// clickable choice (via its AskUserQuestion tool) — configure now / skip this
// session / disable here — before addressing their request. Gated to once per
// session by a marker file keyed on session_id, so later prompts stay silent.
//
// Why a directive and not a native menu: Claude Code has no hook→UI primitive, so
// a genuine option menu can only be raised by the model. This layer is therefore
// best-effort; onboarding.mjs's SessionStart `systemMessage` is the deterministic
// backstop that guarantees the user still SEES the detection if the model skips
// the question. All three options map onto existing plugin mechanisms:
//   • Configure now  → the /orchestrate-config init skill
//   • Skip session   → the marker below (no re-ask this session)
//   • Disable here   → config.mjs set workspace readiness_check false (Setting 2)
//
// Invariants: fast, never throws, never blocks the prompt. Any trouble → exit 0
// silent. "Configured?" is decided deterministically by lib/readiness.mjs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readinessCheckEnabled } from "./config.mjs";
import { readinessState } from "./readiness.mjs";

const MARKER_DIR = path.join(os.homedir(), ".claude", "orchestration", "session-nudges");
const PRUNE_MS = 7 * 24 * 60 * 60 * 1000; // stale markers (>7d) get swept

function readStdin() { try { return fs.readFileSync(0, "utf8"); } catch { return ""; } }
function fileExists(p) { try { fs.accessSync(p); return true; } catch { return false; } }

// Sanitize session_id into a safe filename (ids are normally uuids; defensive).
function markerPath(sid) {
  return path.join(MARKER_DIR, String(sid).replace(/[^A-Za-z0-9._-]/g, "_") + ".seen");
}

// Best-effort sweep so the marker dir stays bounded. Never throws.
function prune() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(MARKER_DIR)) {
      const p = path.join(MARKER_DIR, f);
      try { if (now - fs.statSync(p).mtimeMs > PRUNE_MS) fs.unlinkSync(p); } catch { /* skip */ }
    }
  } catch { /* dir may not exist yet */ }
}

function main() {
  let input = {};
  try { input = JSON.parse(readStdin()); } catch { /* keep defaults */ }
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const sid = input.session_id;
  if (!sid) return; // no session id → can't gate once-per-session safely → stay silent

  // Setting 2: respect the readiness-check toggle (fail-open to ON on trouble).
  if (!readinessCheckEnabled(cwd)) return;

  const st = readinessState(cwd);
  if (!st.applicable || !st.needsSetup) return;

  const mp = markerPath(sid);
  if (fileExists(mp)) return; // already surfaced the question this session

  // Mark BEFORE emitting so a mid-turn crash can't cause a re-ask loop.
  try { fs.mkdirSync(MARKER_DIR, { recursive: true }); fs.writeFileSync(mp, new Date().toISOString() + "\n"); } catch { /* non-fatal */ }
  prune();

  const configMjs = path.join(path.dirname(fileURLToPath(import.meta.url)), "config.mjs");
  const disableCmd = `node "${configMjs}" set workspace readiness_check false "${st.root}"`;

  // Stale = a profile exists but is from an older plugin version → the fix is a
  // REFRESH (/orchestrate-config update, re-derives from durable overrides), not a
  // fresh init. Fresh/interrupted → init.
  const primaryLabel = st.stale ? "Update now" : "Configure now";
  const primaryAction = st.stale
    ? `refresh this workspace via the /orchestrate-config update skill — it re-derives the profile from your `
      + `existing durable overrides, migrating a profile made by an older plugin version.`
    : `set up this workspace via the /orchestrate-config init skill (dispatch the settings-manager, resolve `
      + `every decision it surfaces, finalize and report the profile).`;
  const shortWhat = st.stale
    ? `this workspace's orchestration profile is from an older version and needs a refresh`
    : st.interrupted
      ? `orchestration setup looks interrupted here`
      : `this workspace isn't configured for orchestration (${st.scope})`;
  const longWhat = st.stale
    ? `This workspace HAS an orchestration profile but it fails validation (older plugin schema/version) at ${st.root} — it needs re-deriving, not fresh setup.`
    : st.interrupted
      ? `Orchestration setup for this workspace looks INTERRUPTED (a draft exists but no finalized profile) at ${st.root}.`
      : `This workspace is NOT configured for orchestration yet (detected ${st.scope}) at ${st.root}.`;

  const directive =
    `[orchestration onboarding — fires once per session while this workspace needs attention]\n`
    + `${longWhat}\n`
    + `BEFORE doing anything with the user's request, ask them how to proceed using your interactive `
    + `question tool (AskUserQuestion) — a single question with exactly these options. Briefly make clear `
    + `this is a one-time orchestration-plugin prompt, separate from their request, so they know why `
    + `they're being asked:\n`
    + `  • "${primaryLabel}" — ${primaryAction} DEFER the user's original request: do NOT start working on `
    + `it. Run the ENTIRE flow to completion first. ONLY once it's finished, tell the user it's done and `
    + `THEN return to their original request — restate it briefly so the context is clear before you act.\n`
    + `  • "Skip this session" — do nothing about this; you won't be asked again this session. Proceed `
    + `directly with the user's original request.\n`
    + `  • "Disable here" — run exactly this command, confirm it's off, then proceed with the user's `
    + `original request:\n`
    + `      ${disableCmd}\n`
    + `Do not run any setup or the disable command until the user has chosen. Never interleave it with `
    + `the original request — finish the chosen branch first. If the user ignores the question and simply `
    + `restates their request, honor the request and don't re-ask.`;

  process.stdout.write(JSON.stringify({
    systemMessage: `⚙️  Orchestration: ${shortWhat} — you'll be asked how to proceed.`,
    hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: directive },
  }));
}

try { main(); } catch { /* an onboarding question must never disturb the session */ }
process.exit(0);
