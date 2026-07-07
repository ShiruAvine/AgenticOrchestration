#!/usr/bin/env node
// Run manifest: the on-disk source of truth for ONE orchestration run. Creating
// and mutating it is mechanical, so it is code — the LLM never rewrites the file
// by hand (which is where resume state used to drift). Every verb re-validates
// against schema orchestration/run@1 and rewrites, so the file is always valid
// and resumable.
//
// Verbs:
//   init <run.json> <spec.json>
//       spec: { ticket, topology, workspace_root,
//               bundle,                                 // optional; defaults to "inline" (skip-architect path)
//               active_members: [{id, path}],          // baselines captured here via git
//               execution_order: ["task-01-…", …],
//               tasks: [{id, repo}] }                   // all created as not_started
//   set <run.json> <task-id> <key=value> [<key=value> …]
//       keys: status, verdict, engineer_report, review, user_verified, fix_rounds
//   set-run <run.json> <key=value> [<key=value> …]     // run-level fields: integration_review
//   gates <run.json> <task-id> <gates-json>            // {"test":"pass","build":"fail",…}
//   status <run.json> <run-status>                     // planning|executing|complete|blocked
//   show <run.json>                                    // summary + RESUME-AT pointer
//   validate <run.json>

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { RUN_SCHEMA, validateRun, GATE_KEYS, GATE_RESULTS, TASK_STATUSES, RUN_STATUSES, VERDICTS } from "./schema.mjs";

function die(m, c = 1) { process.stderr.write(m + "\n"); process.exit(c); }
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { die(`cannot read ${p}: ${e.message}`); } }
function save(p, obj) {
  const { valid, errors } = validateRun(obj);
  if (!valid) die("refusing to write INVALID run manifest:\n  " + errors.join("\n  "));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
}
function nowISO() { return new Date().toISOString(); }
function gitHead(cwd) {
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(); }
  catch { return null; }
}

// --- init -------------------------------------------------------------------

function cmdInit(runPath, specPath) {
  const s = readJSON(specPath);
  for (const k of ["ticket", "topology", "active_members", "execution_order", "tasks"]) {
    if (s[k] === undefined) die(`spec missing "${k}"`);
  }
  // bundle is optional — the skip-architect path has no bundle, so default to "inline".
  const bundle = typeof s.bundle === "string" ? s.bundle : "inline";
  const root = s.workspace_root || process.cwd();
  const active_members = s.active_members.map((m) => {
    const abs = path.resolve(root, m.path === "." ? "" : m.path);
    const baseline = gitHead(abs);
    if (!baseline) die(`could not capture git baseline for member "${m.id}" at ${abs}`);
    return { id: m.id, path: m.path, baseline };
  });
  const tasks = s.tasks.map((t) => ({
    id: t.id, repo: t.repo, status: "not_started",
    engineer_report: null, review: null, verdict: null,
    gates_observed: { convention: null, lint: null, test: null, build: null },
    user_verified: false, fix_rounds: 0,
  }));
  const run = {
    schema: RUN_SCHEMA, run: nowISO(), ticket: s.ticket, topology: s.topology,
    bundle, status: "executing", updated: nowISO(),
    active_members, execution_order: s.execution_order, tasks, integration_review: null,
  };
  save(runPath, run);
  process.stdout.write(`initialized run manifest: ${runPath}\n`);
}

// --- mutations --------------------------------------------------------------

function coerce(key, raw) {
  if (key === "user_verified") {
    if (raw === "true") return true; if (raw === "false") return false;
    die(`user_verified must be true|false, got "${raw}"`);
  }
  if (key === "fix_rounds") {
    const n = Number(raw); if (!Number.isInteger(n)) die(`fix_rounds must be an integer, got "${raw}"`); return n;
  }
  if (raw === "null") return null;
  return raw;
}

function findTask(run, id) {
  const t = run.tasks.find((x) => x.id === id);
  if (!t) die(`no task "${id}" in manifest (have: ${run.tasks.map((x) => x.id).join(", ")})`);
  return t;
}

function cmdSet(runPath, taskId, pairs) {
  const run = readJSON(runPath);
  const t = findTask(run, taskId);
  const ALLOWED = { status: TASK_STATUSES, verdict: VERDICTS };
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i < 0) die(`bad assignment "${pair}" (expected key=value)`);
    const key = pair.slice(0, i), val = coerce(key, pair.slice(i + 1));
    if (!["status", "verdict", "engineer_report", "review", "user_verified", "fix_rounds"].includes(key))
      die(`unknown task field "${key}"`);
    if (ALLOWED[key] && !ALLOWED[key].includes(val))
      die(`${key} must be one of ${ALLOWED[key].map(String).join("|")}, got ${JSON.stringify(val)}`);
    t[key] = val;
  }
  run.updated = nowISO();
  save(runPath, run);
  process.stdout.write(`updated ${taskId}: ${pairs.join(" ")}\n`);
}

// Set run-level (not per-task) fields. Currently: integration_review (path|null).
function cmdSetRun(runPath, pairs) {
  const run = readJSON(runPath);
  const ALLOWED = new Set(["integration_review"]);
  for (const pair of pairs) {
    const i = pair.indexOf("=");
    if (i < 0) die(`bad assignment "${pair}" (expected key=value)`);
    const key = pair.slice(0, i);
    if (!ALLOWED.has(key)) die(`unknown run field "${key}" (settable: ${[...ALLOWED].join(", ")})`);
    run[key] = coerce(key, pair.slice(i + 1)); // "null" → null, else the raw string (a path)
  }
  run.updated = nowISO();
  save(runPath, run);
  process.stdout.write(`updated run: ${pairs.join(" ")}\n`);
}

function cmdGates(runPath, taskId, gatesJson) {
  const run = readJSON(runPath);
  const t = findTask(run, taskId);
  let g; try { g = JSON.parse(gatesJson); } catch (e) { die(`gates arg must be JSON: ${e.message}`); }
  for (const k of Object.keys(g)) {
    if (!GATE_KEYS.includes(k)) die(`unknown gate "${k}"`);
    if (!GATE_RESULTS.includes(g[k])) die(`gate ${k} must be one of ${GATE_RESULTS.map(String).join("|")}`);
    t.gates_observed[k] = g[k];
  }
  run.updated = nowISO();
  save(runPath, run);
  process.stdout.write(`recorded gates for ${taskId}: ${JSON.stringify(t.gates_observed)}\n`);
}

function cmdStatus(runPath, status) {
  if (!RUN_STATUSES.includes(status)) die(`status must be one of ${RUN_STATUSES.join("|")}`);
  const run = readJSON(runPath);
  run.status = status; run.updated = nowISO();
  save(runPath, run);
  process.stdout.write(`run status: ${status}\n`);
}

// --- read -------------------------------------------------------------------

function cmdShow(runPath) {
  const run = readJSON(runPath);
  const { valid, errors } = validateRun(run);
  const lines = [];
  lines.push(`RUN ${run.run}  status=${run.status}  topology=${run.topology}`);
  lines.push(`TICKET: ${run.ticket}`);
  lines.push("MEMBERS: " + run.active_members.map((m) => `${m.id}@${m.baseline.slice(0, 8)}`).join(", "));
  lines.push("TASKS:");
  for (const id of run.execution_order) {
    const t = run.tasks.find((x) => x.id === id) || { status: "(missing)" };
    const gates = GATE_KEYS.map((k) => `${k[0]}:${t.gates_observed ? t.gates_observed[k] ?? "-" : "-"}`).join(" ");
    lines.push(`  ${id.padEnd(24)} ${String(t.status).padEnd(22)} verdict=${t.verdict ?? "-"} verified=${t.user_verified ?? "-"} [${gates}]`);
  }
  const next = run.execution_order.find((id) => {
    const t = run.tasks.find((x) => x.id === id);
    return !t || t.status !== "done";
  });
  lines.push(`RESUME AT: ${next || "(all tasks done)"}`);
  if (!valid) lines.push("WARNING — manifest is INVALID:\n  " + errors.join("\n  "));
  process.stdout.write(lines.join("\n") + "\n");
}

function cmdValidate(runPath) {
  const { valid, errors } = validateRun(readJSON(runPath));
  if (!valid) die("INVALID:\n  " + errors.join("\n  "));
  process.stdout.write("OK\n");
}

// --- CLI --------------------------------------------------------------------

const [verb, ...a] = process.argv.slice(2);
switch (verb) {
  case "init": if (!a[1]) die("usage: manifest.mjs init <run.json> <spec.json>"); cmdInit(a[0], a[1]); break;
  case "set": if (!a[2]) die("usage: manifest.mjs set <run.json> <task-id> <key=value> …"); cmdSet(a[0], a[1], a.slice(2)); break;
  case "set-run": if (!a[1]) die("usage: manifest.mjs set-run <run.json> <key=value> …"); cmdSetRun(a[0], a.slice(1)); break;
  case "gates": if (!a[2]) die("usage: manifest.mjs gates <run.json> <task-id> <gates-json>"); cmdGates(a[0], a[1], a[2]); break;
  case "status": if (!a[1]) die("usage: manifest.mjs status <run.json> <run-status>"); cmdStatus(a[0], a[1]); break;
  case "show": if (!a[0]) die("usage: manifest.mjs show <run.json>"); cmdShow(a[0]); break;
  case "validate": if (!a[0]) die("usage: manifest.mjs validate <run.json>"); cmdValidate(a[0]); break;
  default: die("usage: manifest.mjs <init|set|gates|status|show|validate> …");
}
