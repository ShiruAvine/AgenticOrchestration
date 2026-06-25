#!/usr/bin/env node
// Gate runner: execute a member's RECORDED gate commands (from workspace.json) in
// that member's directory and emit observed pass/fail/n-a per gate. This is the
// "independently verify the gates" step of ORCHESTRATION.md made mechanical — the
// orchestrator runs THIS, not a command it composes from prose, so the observed
// result can't drift from what the profile says to run.
//
// Usage:
//   node gates.mjs <workspace.json> <member-id> [--mutate] [--only test,build]
//
// By default, known *mutating* gate forms are converted to a read-only variant
// (eslint `--fix` dropped; prettier `--write` → `--check`) so verification does
// not change the tree. Pass --mutate to run commands verbatim (their edits then
// become part of the task diff, per the workflow).
//
// Output (stdout): JSON
//   { "member": "<id>", "results": {
//       "convention": { "result": "pass|fail|n/a", "command": "<run>", "exit": <code|null> }, … },
//     "observed": { "convention": "pass|fail|n/a", … } }   // compact form for manifest gates
// Exit code: 0 if no gate failed; 1 if any gate failed; 2 on usage/IO error.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { GATE_KEYS, validateWorkspace } from "./schema.mjs";

function die(m, c = 2) { process.stderr.write(m + "\n"); process.exit(c); }

const args = process.argv.slice(2);
const wsPath = args[0];
const memberId = args[1];
if (!memberId) die("usage: gates.mjs <workspace.json> <member-id> [--mutate] [--only k1,k2]");
const mutate = args.includes("--mutate");
const onlyIdx = args.indexOf("--only");
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(",") : null;

let ws;
try { ws = JSON.parse(fs.readFileSync(wsPath, "utf8")); } catch (e) { die(`cannot read ${wsPath}: ${e.message}`); }
const { valid, errors } = validateWorkspace({ ...ws, decisions_needed: undefined });
if (!valid) die("workspace.json is INVALID:\n  " + errors.join("\n  "));

const member = ws.members.find((m) => m.id === memberId);
if (!member) die(`no member "${memberId}" (have: ${ws.members.map((m) => m.id).join(", ")})`);

const cwd = path.resolve(ws.workspace_root, member.path === "." ? "" : member.path);
if (!fs.existsSync(cwd)) die(`member path does not exist: ${cwd}`);

// Best-effort read-only transform for the two common mutating forms.
function readonlyVariant(cmd) {
  let out = cmd.replace(/\s--fix\b/g, "");
  out = out.replace(/--write\b/g, "--check");
  return out;
}

const results = {};
const observed = {};
let anyFail = false;

for (const key of GATE_KEYS) {
  if (only && !only.includes(key)) { results[key] = { result: "n/a", command: null, exit: null, skipped: true }; observed[key] = "n/a"; continue; }
  const raw = member.gates[key];
  if (raw == null) { results[key] = { result: "n/a", command: null, exit: null }; observed[key] = "n/a"; continue; }
  const cmd = mutate ? raw : readonlyVariant(raw);
  try {
    execSync(cmd, { cwd, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 10 * 60 * 1000 });
    results[key] = { result: "pass", command: cmd, exit: 0 };
    observed[key] = "pass";
  } catch (e) {
    anyFail = true;
    const tail = ((e.stdout || "") + (e.stderr || "")).split("\n").slice(-25).join("\n");
    results[key] = { result: "fail", command: cmd, exit: e.status ?? null, tail };
    observed[key] = "fail";
  }
}

process.stdout.write(JSON.stringify({ member: memberId, results, observed }, null, 2) + "\n");
process.exit(anyFail ? 1 : 0);
