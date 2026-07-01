#!/usr/bin/env node
// SessionStart readiness NOTICE — the deterministic, model-independent layer of
// the onboarding flow.
//
// Reads the hook JSON from stdin and, only if the open workspace needs setup AND
// the readiness check is enabled (Setting 2), emits a user-visible `systemMessage`
// (guaranteed to be shown, regardless of what the model does) plus factual
// `additionalContext`. It deliberately does NOT ask a question or run setup — the
// actual interactive choice is raised on the user's first prompt by the
// UserPromptSubmit hook (lib/prompt-nudge.mjs). This notice is the backstop that
// guarantees the user at least SEES the detection even if that model-mediated
// question is skipped. Registered for `startup|resume` so it fires on continued
// sessions too.
//
// Invariants: fires on every qualifying session start, so it must be fast and
// must NEVER throw, block, or print an error. Any problem → exit 0 silent.
// "Configured?" is decided deterministically by lib/readiness.mjs.

import fs from "node:fs";
import { readinessCheckEnabled } from "./config.mjs";
import { readinessState } from "./readiness.mjs";

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}
function cwdFromInput(raw) {
  try { const j = JSON.parse(raw); if (j && typeof j.cwd === "string") return j.cwd; } catch { /* fall through */ }
  return process.cwd();
}
// `systemMessage` (top-level) is shown to the USER directly — additionalContext
// alone only reaches the model, which may silently ignore it. We emit both.
function emit(systemMessage, additionalContext) {
  process.stdout.write(JSON.stringify({
    systemMessage,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  }));
}

function main() {
  const cwd = cwdFromInput(readStdin());

  // Setting 2: respect the readiness-check toggle (fail-open to ON on trouble).
  if (!readinessCheckEnabled(cwd)) return;

  const st = readinessState(cwd);
  if (!st.applicable || !st.needsSetup) return; // nothing to orchestrate, or ready → silent

  if (st.interrupted) {
    emit(
      `⚙️  Orchestration: setup for this workspace looks interrupted — you'll be asked how to proceed (or run \`/orchestrate-config init\`).`,
      `The orchestration readiness check found an INTERRUPTED setup in ${st.root} (a workspace draft `
      + `exists but no finalized profile). On the user's next prompt they will be asked how to proceed. `
      + `Do not run setup automatically.`);
    return;
  }

  emit(
    `⚙️  Orchestration: this workspace isn't configured yet (${st.scope}) — you'll be asked how to proceed (or run \`/orchestrate-config init\`).`,
    `The orchestration readiness check ran: ${st.root} has no valid workspace profile yet (detected ${st.scope}). `
    + `On the user's next prompt they will be asked how to proceed. Do not run setup automatically.`);
}

try { main(); } catch { /* a readiness notice must never disturb the session */ }
process.exit(0);
