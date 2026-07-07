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
// (eslint `--fix` dropped; prettier `--write`, black, `ruff format`, `cargo fmt`,
// rustfmt → their `--check` forms) so verification does not change the tree. This is
// a best-effort heuristic (see readonlyVariant) — unrecognized in-place formatters
// run verbatim. Pass --mutate to run commands verbatim (their edits then become part
// of the task diff, per the workflow).
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
if (onlyIdx >= 0 && !args[onlyIdx + 1]) die("--only requires a comma-separated list of gate keys");
const only = onlyIdx >= 0 ? args[onlyIdx + 1].split(",").map((s) => s.trim()).filter(Boolean) : null;

let ws;
try { ws = JSON.parse(fs.readFileSync(wsPath, "utf8")); } catch (e) { die(`cannot read ${wsPath}: ${e.message}`); }
const { valid, errors } = validateWorkspace({ ...ws, decisions_needed: undefined });
if (!valid) die("workspace.json is INVALID:\n  " + errors.join("\n  "));

const member = ws.members.find((m) => m.id === memberId);
if (!member) die(`no member "${memberId}" (have: ${ws.members.map((m) => m.id).join(", ")})`);

const cwd = path.resolve(ws.workspace_root, member.path === "." ? "" : member.path);
if (!fs.existsSync(cwd)) die(`member path does not exist: ${cwd}`);

// Best-effort read-only transform for common mutating formatter/linter forms, so a
// default gate run doesn't rewrite the working tree. Each rule only fires when the
// mutating flag is present and the check flag isn't already there.
//
// LIMITATION: this is a heuristic on the command string, not a guarantee. Only the
// forms below are neutralized; any other in-place formatter (e.g. `gofmt -w`, a custom
// script) runs verbatim and could modify files. For those, record a check-style gate
// command in the profile, or pass --mutate deliberately (edits then join the diff).
function readonlyVariant(cmd) {
  let out = cmd;
  out = out.replace(/\s--fix\b/g, "");                                   // eslint --fix
  out = out.replace(/--write\b/g, "--check");                            // prettier --write
  if (/\bblack\b/.test(out) && !/(--check|--diff)\b/.test(out)) out = out.replace(/\bblack\b/, "black --check");
  if (/\bruff\s+format\b/.test(out) && !/--check\b/.test(out)) out = out.replace(/\bruff\s+format\b/, "ruff format --check");
  if (/\bcargo\s+fmt\b/.test(out) && !/--check\b/.test(out)) out = out.replace(/\bcargo\s+fmt\b/, "cargo fmt --check");
  if (/\brustfmt\b/.test(out) && !/--check\b/.test(out)) out = out.replace(/\brustfmt\b/, "rustfmt --check");
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
