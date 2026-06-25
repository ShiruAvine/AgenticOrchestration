#!/usr/bin/env node
// Deterministic workspace detection. This is the executable form of the
// "Detection algorithm" section of WORKSPACE.md — that prose is now this
// script's SPEC, not runtime instructions for an LLM. Every field is derived
// from a command output or a file read; nothing is guessed. Ambiguity becomes
// a `decisions_needed` entry, never an invented value.
//
// Usage:   node detect.mjs [workspace-root]      (defaults to cwd)
// Output:  a workspace.json object (schema orchestration/workspace@1) on stdout,
//          with `decisions_needed` populated. The command/agent layer resolves
//          those decisions and writes the finalized profile via profile.mjs.
//
// Exit codes: 0 = detected; 2 = nothing to orchestrate (blocked); 1 = error.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { WORKSPACE_SCHEMA, validateWorkspace } from "./schema.mjs";

const IGNORE_DIRS = new Set(["node_modules", "vendor", "dist", "build", ".git"]);
const DEFAULT_BRANCHES = new Set(["main", "master"]);

const FRONTEND_RE = /^(react|vue|svelte|next|@angular\/core|@sveltejs\/kit)$|^vite$/;
const BACKEND_NODE_RE = /^@nestjs\/core$|^express$|^fastify$|^koa$|^@hapi\/hapi$/;
// Only true application frameworks count as a web-service signal. aiohttp/tornado
// are deliberately excluded: they are widely transitive (tornado ships with Jupyter)
// and would misflag notebook/data repos as backend services.
const PY_WEB_RE = /\b(flask|django|fastapi|starlette|sanic)\b/i;

// --- shell / fs helpers -----------------------------------------------------

function git(cwd, args) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}
function exists(p) { try { fs.accessSync(p); return true; } catch { return false; } }
function readJSON(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; } }
function readText(p) { try { return fs.readFileSync(p, "utf8"); } catch { return null; } }
function listDirs(p) {
  try {
    return fs.readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !IGNORE_DIRS.has(d.name))
      .map((d) => d.name);
  } catch { return []; }
}

// --- topology ---------------------------------------------------------------

function detectTopology(root) {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]) === "true";
  if (inside) {
    const top = git(root, ["rev-parse", "--show-toplevel"]) || root;
    const subProjects = findSubProjects(top);
    return { topology: subProjects.length > 1 ? "monorepo" : "single-repo", root: top, subProjects };
  }
  // not a repo → scan immediate children for independent repos
  const childRepos = listDirs(root).filter((d) => exists(path.join(root, d, ".git")));
  if (childRepos.length >= 1) return { topology: "multi-repo", root, childRepos };
  return { topology: null, root, childRepos: [] };
}

// Distinct sub-project markers under a single repo (for mono vs single).
function findSubProjects(top) {
  const rootPkg = readJSON(path.join(top, "package.json"));
  if (rootPkg && rootPkg.workspaces) return ["<workspaces-field>", "<workspaces-field-2>"]; // >1 → monorepo
  for (const f of ["pnpm-workspace.yaml", "nx.json", "turbo.json", "lerna.json"]) {
    if (exists(path.join(top, f))) return ["<" + f + ">", "<" + f + "-2>"];
  }
  // else: count distinct subdirs (depth ≤ 2) holding a manifest, excluding root
  const manifests = ["package.json", "pyproject.toml", "go.mod"];
  const found = new Set();
  const walk = (dir, depth) => {
    if (depth > 2) return;
    for (const name of listDirs(dir)) {
      const sub = path.join(dir, name);
      if (manifests.some((m) => exists(path.join(sub, m)))) found.add(path.relative(top, sub));
      walk(sub, depth + 1);
    }
  };
  walk(top, 1);
  return [...found];
}

// --- per-member profiling ---------------------------------------------------

// .ipynb at the member root or any immediate subdirectory.
function hasNotebooks(abs) {
  if (!exists(abs)) return false;
  let top;
  try { top = fs.readdirSync(abs, { withFileTypes: true }); } catch { return false; }
  if (top.some((d) => d.isFile() && d.name.endsWith(".ipynb"))) return true;
  return top
    .filter((d) => d.isDirectory() && !IGNORE_DIRS.has(d.name))
    .some((d) => {
      try { return fs.readdirSync(path.join(abs, d.name)).some((f) => f.endsWith(".ipynb")); }
      catch { return false; }
    });
}

function classifyStack(abs) {
  const pkg = readJSON(path.join(abs, "package.json"));
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const keys = Object.keys(deps);
    const ts = "typescript" in deps || exists(path.join(abs, "tsconfig.json"));
    const isFront = keys.some((k) => FRONTEND_RE.test(k));
    const isBack = keys.some((k) => BACKEND_NODE_RE.test(k));
    let label = "Node";
    if (keys.some((k) => /^@nestjs\/core$/.test(k))) label = "NestJS";
    else if (deps.express) label = "Express";
    else if (deps.fastify) label = "Fastify";
    else if (deps.koa) label = "Koa";
    else if (deps.next) label = "Next.js";
    else if (deps.react) label = "React";
    else if (deps.vue) label = "Vue";
    else if (deps.svelte || deps["@sveltejs/kit"]) label = "Svelte";
    return { kind: "node", pkg, deps, label: `${label}/${ts ? "TS" : "JS"}`, isFront, isBack };
  }
  // python
  const req = readText(path.join(abs, "requirements.txt")) || "";
  const pyproj = readText(path.join(abs, "pyproject.toml")) || "";
  const notebooks = hasNotebooks(abs);
  if (req || pyproj || notebooks) {
    const blob = req + "\n" + pyproj;
    const isWeb = PY_WEB_RE.test(blob);
    const isML = /catboost|sklearn|scikit-learn|pandas|numpy|torch|tensorflow|xgboost|jupyter/i.test(blob);
    return { kind: "python", label: "Python", isFront: false, isBack: isWeb,
      isResearch: !isWeb && (notebooks || isML) };
  }
  if (exists(path.join(abs, "go.mod"))) return { kind: "go", label: "Go", isFront: false, isBack: true };
  // infra-only?
  const composeFiles = exists(abs)
    ? fs.readdirSync(abs).filter((f) => /^docker-compose.*\.ya?ml$/.test(f))
    : [];
  if (composeFiles.length && !exists(path.join(abs, "package.json"))) {
    return { kind: "infra", label: "infra (docker-compose)", isFront: false, isBack: false, isInfra: true };
  }
  return { kind: "unknown", label: "unknown", isFront: false, isBack: false };
}

// Exact gate command strings from package.json scripts (never fabricated).
function extractGates(s, notes) {
  if (!s) return { convention: null, lint: null, test: null, build: null };
  const gates = {
    convention: s.format ?? null,
    lint: s.lint ?? null,
    test: s.test ?? null,
    build: s.build ?? null,
  };
  if (gates.build == null) {
    const fallbackKey = Object.keys(s)
      .filter((k) => /^build(:|$)/.test(k) && !/docker/i.test(k))
      .sort((a, b) => (a === "build:local" ? -1 : b === "build:local" ? 1 : a.localeCompare(b)))[0];
    if (fallbackKey) { gates.build = s[fallbackKey]; notes.push(`build gate taken from "${fallbackKey}" script`); }
  }
  if (s["test:e2e"]) notes.push(`has test:e2e = ${s["test:e2e"]}`);
  return gates;
}

function classifyRole(stack) {
  if (stack.isFront && stack.isBack)
    return { role: "chuck-backend-engineer", ambiguous: true };
  if (stack.isFront) return { role: "chuck-frontend-engineer" };
  if (stack.isBack) return { role: "chuck-backend-engineer" };
  if (stack.isResearch) return { role: "out-of-scope", role_reason: "research", noAgent: true };
  if (stack.isInfra) return { role: "out-of-scope", role_reason: "infra", noAgent: true };
  return { role: "out-of-scope", role_reason: "unknown stack", noAgent: true };
}

function profileMember(root, rel, topology) {
  const abs = path.join(root, rel === "." ? "" : rel);
  const notes = [];
  const isGit = exists(path.join(abs, ".git")) || git(abs, ["rev-parse", "--is-inside-work-tree"]) === "true";
  const branch = isGit
    ? (git(abs, ["symbolic-ref", "--short", "HEAD"]) || git(abs, ["rev-parse", "--abbrev-ref", "HEAD"]))
    : null;
  const stack = classifyStack(abs);
  const claudeMd = exists(path.join(abs, "CLAUDE.md"));
  const gates = extractGates(stack.pkg && stack.pkg.scripts, notes);
  const roleInfo = classifyRole(stack);

  if (branch && !DEFAULT_BRANCHES.has(branch))
    notes.push(`on branch "${branch}" (not a long-lived default) — re-verify diff baseline per run`);
  if (!claudeMd && roleInfo.role.startsWith("chuck-"))
    notes.push("no CLAUDE.md — specialists operate with reduced project context");
  if (gates.lint == null && gates.convention == null && roleInfo.role.startsWith("chuck-"))
    notes.push("no lint/format script — runs test+build gates only");

  const reportsDir = topology === "multi-repo"
    ? path.join(rel, ".claude/reports") + "/"
    : ".claude/reports/";

  const member = {
    id: rel === "." ? path.basename(root) : path.basename(rel),
    path: rel,
    git: !!isGit,
    default_branch: branch,
    stack: stack.label,
    claude_md: claudeMd ? "present" : "absent",
    role: roleInfo.role,
    reports_dir: reportsDir,
    gates,
    notes,
  };
  if (roleInfo.role_reason) member.role_reason = roleInfo.role_reason;
  return { member, roleInfo, claudeMd };
}

// --- decisions --------------------------------------------------------------

function decisionsFor(member, roleInfo, claudeMd) {
  const out = [];
  if (roleInfo.ambiguous) {
    out.push({
      member: member.id,
      question: `${member.id} has both frontend and backend deps — which engineer owns it?`,
      recommended: "chuck-backend-engineer",
      options: ["chuck-backend-engineer", "chuck-frontend-engineer", "split"],
    });
  }
  if (roleInfo.noAgent) {
    const reason = member.role_reason;
    out.push({
      member: member.id,
      question: `${member.id} (${reason}) fits no active specialist agent — exclude, or keep in scope flagged?`,
      recommended: `out-of-scope: ${reason}`,
      options: [`out-of-scope: ${reason}`, `in-scope:no-matching-agent (${reason})`],
    });
  }
  if (!claudeMd && member.role.startsWith("chuck-")) {
    out.push({
      member: member.id,
      question: `${member.id} has no CLAUDE.md — how should specialists bind to it?`,
      recommended: "proceed with reduced context",
      options: ["generate minimal CLAUDE.md", "proceed with reduced context", "exclude"],
    });
  }
  for (const k of ["test", "build"]) {
    if (member.gates[k] == null && member.role.startsWith("chuck-")) {
      out.push({
        member: member.id,
        question: `${member.id} has no detectable ${k} gate — confirm "none" or provide a command?`,
        recommended: "none",
        options: ["none", "<provide command>"],
      });
    }
  }
  return out;
}

// --- main -------------------------------------------------------------------

function detect(rootArg) {
  const root = path.resolve(rootArg || process.cwd());
  const topo = detectTopology(root);
  if (!topo.topology) {
    return { blocked: true, message: `No git repository in ${root} and no child repos — nothing to orchestrate. Where does the code live?` };
  }

  let relPaths;
  if (topo.topology === "single-repo") relPaths = ["."];
  else if (topo.topology === "multi-repo") relPaths = topo.childRepos.sort();
  else relPaths = topo.subProjects.filter((p) => !p.startsWith("<")).sort(); // monorepo

  const members = [];
  const decisions = [];
  for (const rel of relPaths) {
    const { member, roleInfo, claudeMd } = profileMember(topo.root, rel, topo.topology);
    members.push(member);
    decisions.push(...decisionsFor(member, roleInfo, claudeMd));
  }

  return {
    schema: WORKSPACE_SCHEMA,
    generated: new Date().toISOString(),
    topology: topo.topology,
    workspace_root: topo.root,
    members,
    decisions_needed: decisions,
    defaults: { architect: "default-on", parallelism: "opt-in", human_gate: "per-task" },
  };
}

// CLI entry
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const result = detect(process.argv[2]);
  if (result.blocked) {
    process.stderr.write(result.message + "\n");
    process.exit(2);
  }
  // Validate facts portion (decisions_needed is allowed pre-finalize).
  const check = validateWorkspace({ ...result, decisions_needed: undefined });
  if (!check.valid) {
    process.stderr.write("detect.mjs produced an invalid workspace shape:\n" + check.errors.join("\n") + "\n");
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}

export { detect, detectTopology, classifyStack, classifyRole, extractGates };
