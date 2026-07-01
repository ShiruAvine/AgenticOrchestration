#!/usr/bin/env node
// Workspace profile: validate + render a human-readable markdown view.
// workspace.json is the SOURCE OF TRUTH; the rendered workspace.md is a
// generated view for humans (never the thing other steps parse — they read the
// JSON). The profile is DERIVED (detected ⊕ overrides) by lib/overrides.mjs;
// this module no longer merges — it only validates and renders.
//
// Verbs:
//   node profile.mjs validate <workspace.json>
//       → exit 0 + "OK" if it conforms to schema; exit 1 + errors otherwise.
//   node profile.mjs render <workspace.json> [--out <path>]
//       → emits the markdown view (stdout or file).

import fs from "node:fs";
import { validateWorkspace, GATE_KEYS, KNOWLEDGE_SLOTS } from "./schema.mjs";

function die(msg, code = 1) { process.stderr.write(msg + "\n"); process.exit(code); }
function readJSON(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { die(`cannot read/parse ${p}: ${e.message}`); }
}
function outArg(args) {
  const i = args.indexOf("--out");
  return i >= 0 ? args[i + 1] : null;
}
function emit(text, out) {
  if (out) { fs.writeFileSync(out, text); process.stdout.write(`wrote ${out}\n`); }
  else process.stdout.write(text);
}

// --- validate ---------------------------------------------------------------

function cmdValidate(file) {
  const obj = readJSON(file);
  const { valid, errors } = validateWorkspace({ ...obj, decisions_needed: undefined });
  if (!valid) die("INVALID:\n  " + errors.join("\n  "));
  process.stdout.write("OK\n");
}

// --- render -----------------------------------------------------------------

function activeRoles(members) {
  const roles = new Set(members.filter((m) => m.role.startsWith("chuck-")).map((m) => m.role));
  return [...roles];
}

function perCaseRows(members) {
  const rows = [];
  for (const m of members) {
    if (m.role === "in-scope:no-matching-agent") {
      rows.push([`${m.id} (${m.role_reason})`,
        `IN SCOPE but no matching specialist agent. \`/orchestrate\` must flag this before assigning work (no fitting \`chuck-*\` role; gates usually absent).`]);
    } else if (m.role === "out-of-scope") {
      rows.push([`${m.id} (${m.role_reason})`, `Excluded from orchestration (out-of-scope: ${m.role_reason}).`]);
    }
    for (const n of m.notes || []) rows.push([m.id, n]);
  }
  return rows;
}

function howToRun(ws) {
  if (ws.topology === "multi-repo") {
    return `Invoke \`/orchestrate\` from the workspace root: ${ws.workspace_root}
Multi-repo: each member is an autonomous repo (own history, branch, CLAUDE.md, .claude/).
Per ticket choose the active member set; chuck-architect sets ASSIGNED_REPO per task;
engineers read that member's CLAUDE.md, edit only within its path, and run its gates
from this profile. Diff baselines are per-member. Reports go to each member's reports_dir.`;
  }
  if (ws.topology === "monorepo") {
    return `Invoke \`/orchestrate\` from the repo root: ${ws.workspace_root}
Monorepo: one repo, multiple sub-projects. Per-member diffs are scoped by path
(\`git diff <baseline> -- <member-path>\`); reports share one tree tagged by member.`;
  }
  return `Invoke \`/orchestrate\` from the repo root: ${ws.workspace_root}
Single-repo: one member; ASSIGNED_REPO can be omitted. One diff baseline.`;
}

function gateLine(g) {
  return GATE_KEYS.map((k) => `${k}=${g[k] == null ? "none" : g[k]}`).join("  ");
}

function knowledgeLine(k) {
  if (!k) return "—";
  const parts = KNOWLEDGE_SLOTS.map((s) => `${s}=${k[s] == null ? "—" : k[s]}`);
  const extraKeys = k.extra ? Object.keys(k.extra) : [];
  if (extraKeys.length) parts.push(`extra=[${extraKeys.join(", ")}]`);
  return parts.join("  ");
}

function cmdRender(file, out) {
  const ws = readJSON(file);
  const { valid, errors } = validateWorkspace({ ...ws, decisions_needed: undefined });
  if (!valid) die("cannot render an INVALID profile:\n  " + errors.join("\n  "));

  const L = [];
  L.push("# Orchestration Workspace Profile (generated view)");
  L.push("<!-- Generated from workspace.json by lib/profile.mjs. Do NOT hand-edit:");
  L.push("     edit workspace.json (the source of truth) and re-render. -->");
  L.push(`GENERATED: ${ws.generated}`);
  L.push(`TOPOLOGY: ${ws.topology}`);
  L.push(`WORKSPACE_ROOT: ${ws.workspace_root}`);
  L.push("");
  L.push("## Members");
  for (const m of ws.members) {
    L.push(`- id: ${m.id}`);
    L.push(`  path: ${m.path}`);
    L.push(`  git: ${m.git}   default_branch: ${m.default_branch ?? "—"}`);
    L.push(`  stack: ${m.stack}`);
    L.push(`  claude_md: ${m.claude_md}`);
    L.push(`  role: ${m.role}${m.role_reason ? ` (${m.role_reason})` : ""}`);
    L.push(`  gates: ${gateLine(m.gates)}`);
    L.push(`  knowledge: ${knowledgeLine(m.knowledge)}`);
    L.push(`  reports_dir: ${m.reports_dir}`);
    if (m.notes && m.notes.length) L.push(`  notes: ${m.notes.join("; ")}`);
  }
  L.push("");
  L.push("## Active roles");
  const ar = activeRoles(ws.members);
  L.push(ar.length ? `- ${ar.join("\n- ")}` : "- (none active)");
  const flagged = ws.members.filter((m) => m.role === "in-scope:no-matching-agent");
  if (flagged.length) L.push(`NOTE: ${flagged.map((m) => m.id).join(", ")} in scope but NO matching agent — see Per-case handling.`);
  L.push("");
  L.push("## Defaults");
  L.push(`architect: ${ws.defaults.architect}`);
  L.push(`parallelism: ${ws.defaults.parallelism}`);
  L.push(`human_gate: ${ws.defaults.human_gate}`);
  L.push("");
  L.push("## Per-case handling");
  L.push("| Case | Rule |");
  L.push("|------|------|");
  for (const [c, r] of perCaseRows(ws.members)) L.push(`| ${c} | ${r} |`);
  L.push("");
  L.push("## How to run");
  L.push(howToRun(ws));
  L.push("");
  emit(L.join("\n"), out);
}

// --- CLI --------------------------------------------------------------------

const [verb, ...rest] = process.argv.slice(2);
const out = outArg(rest);
switch (verb) {
  case "validate": if (!rest[0]) die("usage: profile.mjs validate <workspace.json>"); cmdValidate(rest[0]); break;
  case "render": if (!rest[0]) die("usage: profile.mjs render <workspace.json> [--out <path>]"); cmdRender(rest[0], out); break;
  default: die("usage: profile.mjs <validate|render> ...");
}
