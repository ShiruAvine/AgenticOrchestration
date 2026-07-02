#!/usr/bin/env node
// Deterministic writer for the optional "auto-save reports" convenience.
//
// A plugin cannot grant itself permissions — Claude Code keeps `permissions.allow`
// in the user's own settings behind the trust gate. So, only when the user opts in
// during `/orchestrate-config init`, this adds ONE narrowly-scoped allow-rule to
// <workspace-root>/.claude/settings.local.json (personal, gitignored):
//
//     Edit(**/.claude/reports/**)
//
// `Edit(...)` rules cover every file-writing tool (Write + Edit), and the
// `**/.claude/reports/**` gitignore pattern matches the workspace-root reports tree
// AND every per-member `<member>/.claude/reports/` (monorepo / multi-repo). Effect:
// engineer/reviewer/architect report writes stop prompting. Scoped to the gitignored
// reports tree only — never a broad write grant.
//
// Merge-safe: preserves every other key and existing allow-rule, is idempotent, and
// if settings.local.json exists but is not valid JSON it ABORTS rather than
// clobbering the user's file. Applies in a NEW session (settings read at start).
//
// Verbs:
//   node settings.mjs allow-reports <workspace-root>   # add the rule (idempotent)
//   node settings.mjs has-reports   <workspace-root>   # exit 0 = present, 3 = absent

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPORTS_RULE = "Edit(**/.claude/reports/**)";

function die(msg, code = 1) { process.stderr.write(msg + "\n"); process.exit(code); }
function settingsPath(root) { return path.join(root || process.cwd(), ".claude", "settings.local.json"); }

// Read existing settings. Missing/empty → {}. Malformed → abort (never clobber).
function readSettings(p) {
  if (!fs.existsSync(p)) return {};
  let raw;
  try { raw = fs.readFileSync(p, "utf8"); } catch (e) { die(`cannot read ${p}: ${e.message}`); }
  if (raw.trim() === "") return {};
  try { return JSON.parse(raw); }
  catch (e) { die(`refusing to modify ${p}: it is not valid JSON (${e.message}). Fix it by hand, then re-run.`); }
}

function hasRule(s) {
  return !!(s && s.permissions && Array.isArray(s.permissions.allow) && s.permissions.allow.includes(REPORTS_RULE));
}

function cmdAllow(root) {
  const p = settingsPath(root);
  const s = readSettings(p);
  if (hasRule(s)) { process.stdout.write(`already set: ${REPORTS_RULE} in ${p}\n`); return; }
  if (s.permissions == null || typeof s.permissions !== "object" || Array.isArray(s.permissions)) s.permissions = {};
  if (!Array.isArray(s.permissions.allow)) s.permissions.allow = [];
  s.permissions.allow.push(REPORTS_RULE);
  fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
  process.stdout.write(`added ${REPORTS_RULE} to ${p} — report writes will stop prompting in a new session\n`);
}

// fileURLToPath (not URL.pathname): the latter yields "/E:/..." on Windows.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [verb, root] = process.argv.slice(2);
  switch (verb) {
    case "allow-reports":
      if (!root) die("usage: settings.mjs allow-reports <workspace-root>");
      cmdAllow(root);
      break;
    case "has-reports":
      if (!root) die("usage: settings.mjs has-reports <workspace-root>");
      process.exit(hasRule(readSettings(settingsPath(root))) ? 0 : 3);
    default:
      die("usage: settings.mjs <allow-reports|has-reports> <workspace-root>");
  }
}

export { REPORTS_RULE, hasRule };
