#!/usr/bin/env node
// SessionStart readiness hook. Three states, all deterministic (lib/readiness.mjs):
//
//   1. Nothing to orchestrate here            → silent.
//   2. Workspace UNconfigured (needs setup)   → if `readiness_check` is on: a
//      user-visible `systemMessage` NOTICE (the model-independent backstop) plus
//      factual `additionalContext`. The actual "how do you want to proceed?" question
//      is raised on the first prompt by lib/prompt-nudge.mjs (UserPromptSubmit).
//   3. Workspace CONFIGURED                    → if `proactive_orchestration` is on:
//      model-facing `additionalContext` that primes the orchestrator role for the
//      session (route code work through /orchestrate). No systemMessage — this is
//      standing guidance for the model, not a user alert. Off → silent (invoke
//      /orchestrate on demand only).
//
// Invariants: fires on every qualifying session start, so it must be fast and must
// NEVER throw, block, or print an error. Any problem → exit 0 silent. "Configured?"
// is decided deterministically by lib/readiness.mjs, never by reading markdown.

import fs from "node:fs";
import { readinessCheckEnabled, proactiveOrchestrationEnabled } from "./config.mjs";
import { readinessState } from "./readiness.mjs";

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}
function cwdFromInput(raw) {
  try { const j = JSON.parse(raw); if (j && typeof j.cwd === "string") return j.cwd; } catch { /* fall through */ }
  return process.cwd();
}
// `systemMessage` (top-level) is shown to the USER directly. additionalContext only
// reaches the model. A falsy systemMessage is omitted from the JSON (model-only output).
function emit(systemMessage, additionalContext) {
  process.stdout.write(JSON.stringify({
    systemMessage,
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  }));
}

function main() {
  const cwd = cwdFromInput(readStdin());

  const st = readinessState(cwd);
  if (!st.applicable) return; // nothing to orchestrate here → silent

  if (st.needsSetup) {
    // Setting: the onboarding nudge (fail-open to ON on trouble).
    if (!readinessCheckEnabled(cwd)) return;
    if (st.stale) {
      emit(
        `⚙️  Orchestration: this workspace's profile is from an older plugin version — refresh it with \`/orchestrate-config update\`.`,
        `The orchestration profile at ${st.profile} exists but fails validation (older schema/version). The `
        + `workspace IS set up — it just needs re-deriving, NOT a fresh init. On the user's next prompt they will `
        + `be asked how to proceed; the fix is \`/orchestrate-config update\` (re-derives from the existing durable `
        + `overrides). Do not run it automatically.`);
      return;
    }
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
    return;
  }

  // Configured → prime the orchestrator role, unless the user turned it off.
  if (!proactiveOrchestrationEnabled(cwd)) return;
  emit(
    undefined, // model-facing only; no user banner
    `This workspace is configured for orchestration (profile: ${st.profile}). For any non-trivial `
    + `code-touching work here, act as the ORCHESTRATOR per ORCHESTRATION.md: route the work through the `
    + `/orchestrate skill (decompose via chuck-architect, dispatch to chuck-engineer, independently verify `
    + `gates, review) rather than editing feature code directly, and proactively propose /orchestrate when a `
    + `request is code work. Skip orchestration only for docs-only edits, questions/investigations, or trivial `
    + `non-code changes. (The user can turn this prompt off via the proactive_orchestration setting.)`);
}

try { main(); } catch { /* a readiness hook must never disturb the session */ }
process.exit(0);
