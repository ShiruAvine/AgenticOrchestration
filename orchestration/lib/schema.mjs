// Zero-dependency validators for the orchestration data shapes.
//
// These are the single source of truth for what a workspace profile and a run
// manifest must contain. detect.mjs / profile.mjs / manifest.mjs all validate
// through here, so a malformed or hand-edited file fails LOUDLY against a known
// shape instead of being silently misread by an LLM downstream.
//
// Each validator returns { valid: boolean, errors: string[] } — errors are
// path-qualified (e.g. "members[2].gates.test: expected string|null").

export const WORKSPACE_SCHEMA = "orchestration/workspace@1";
export const RUN_SCHEMA = "orchestration/run@1";

export const TOPOLOGIES = ["single-repo", "monorepo", "multi-repo"];
export const ROLES = [
  "chuck-backend-engineer",
  "chuck-frontend-engineer",
  "in-scope:no-matching-agent",
  "out-of-scope",
];
export const GATE_KEYS = ["convention", "lint", "test", "build"];
export const RUN_STATUSES = ["planning", "executing", "complete", "blocked"];
export const TASK_STATUSES = [
  "not_started", "in_progress", "gates_verified",
  "awaiting_review", "awaiting_verification", "done", "blocked",
];
export const VERDICTS = ["approve", "revise", "reject", null];
export const GATE_RESULTS = ["pass", "fail", "n/a", null];

// --- tiny check helpers -----------------------------------------------------

function isString(v) { return typeof v === "string"; }
function isBool(v) { return typeof v === "boolean"; }
function isInt(v) { return Number.isInteger(v); }
function isStringOrNull(v) { return v === null || typeof v === "string"; }

function checkEnum(errs, path, v, allowed) {
  if (!allowed.includes(v)) {
    const show = allowed.map((a) => (a === null ? "null" : `"${a}"`)).join(" | ");
    errs.push(`${path}: expected one of ${show}, got ${JSON.stringify(v)}`);
  }
}
function checkType(errs, path, v, pred, label) {
  if (!pred(v)) errs.push(`${path}: expected ${label}, got ${JSON.stringify(v)}`);
}
function checkArray(errs, path, v) {
  if (!Array.isArray(v)) { errs.push(`${path}: expected array`); return false; }
  return true;
}

// --- workspace --------------------------------------------------------------

export function validateWorkspace(obj) {
  const errs = [];
  if (obj == null || typeof obj !== "object") {
    return { valid: false, errors: ["root: expected an object"] };
  }
  if (obj.schema !== WORKSPACE_SCHEMA) {
    errs.push(`schema: expected "${WORKSPACE_SCHEMA}", got ${JSON.stringify(obj.schema)}`);
  }
  checkType(errs, "generated", obj.generated, isString, "ISO string");
  checkEnum(errs, "topology", obj.topology, TOPOLOGIES);
  checkType(errs, "workspace_root", obj.workspace_root, isString, "absolute path string");

  if (checkArray(errs, "members", obj.members)) {
    if (obj.members.length === 0) errs.push("members: must have at least one member");
    obj.members.forEach((m, i) => validateMember(errs, `members[${i}]`, m));
    const ids = obj.members.map((m) => m && m.id);
    const dupes = ids.filter((id, i) => id && ids.indexOf(id) !== i);
    if (dupes.length) errs.push(`members: duplicate id(s) ${[...new Set(dupes)].join(", ")}`);
  }

  // decisions_needed is optional (empty/absent once finalized)
  if (obj.decisions_needed !== undefined && checkArray(errs, "decisions_needed", obj.decisions_needed)) {
    obj.decisions_needed.forEach((d, i) => {
      const p = `decisions_needed[${i}]`;
      checkType(errs, `${p}.member`, d && d.member, isString, "member id string");
      checkType(errs, `${p}.question`, d && d.question, isString, "string");
      checkType(errs, `${p}.recommended`, d && d.recommended, isString, "string");
    });
  }

  if (obj.defaults == null || typeof obj.defaults !== "object") {
    errs.push("defaults: expected an object");
  } else {
    checkType(errs, "defaults.architect", obj.defaults.architect, isString, "string");
    checkType(errs, "defaults.parallelism", obj.defaults.parallelism, isString, "string");
    checkType(errs, "defaults.human_gate", obj.defaults.human_gate, isString, "string");
  }

  return { valid: errs.length === 0, errors: errs };
}

function validateMember(errs, p, m) {
  if (m == null || typeof m !== "object") { errs.push(`${p}: expected an object`); return; }
  checkType(errs, `${p}.id`, m.id, isString, "string");
  checkType(errs, `${p}.path`, m.path, isString, "string");
  checkType(errs, `${p}.git`, m.git, isBool, "boolean");
  checkType(errs, `${p}.default_branch`, m.default_branch, isStringOrNull, "string|null");
  checkType(errs, `${p}.stack`, m.stack, isString, "string");
  checkEnum(errs, `${p}.claude_md`, m.claude_md, ["present", "absent"]);
  checkEnum(errs, `${p}.role`, m.role, ROLES);
  // role_reason required exactly for the two scope-variant roles
  if (m.role === "in-scope:no-matching-agent" || m.role === "out-of-scope") {
    checkType(errs, `${p}.role_reason`, m.role_reason, isString, "string (required for scope-variant roles)");
  }
  checkType(errs, `${p}.reports_dir`, m.reports_dir, isString, "string");
  if (m.gates == null || typeof m.gates !== "object") {
    errs.push(`${p}.gates: expected an object`);
  } else {
    for (const k of GATE_KEYS) {
      checkType(errs, `${p}.gates.${k}`, m.gates[k], isStringOrNull, "string|null (null = no gate)");
    }
  }
  if (m.notes !== undefined && checkArray(errs, `${p}.notes`, m.notes)) {
    m.notes.forEach((n, i) => checkType(errs, `${p}.notes[${i}]`, n, isString, "string"));
  }
}

// --- run manifest -----------------------------------------------------------

export function validateRun(obj) {
  const errs = [];
  if (obj == null || typeof obj !== "object") {
    return { valid: false, errors: ["root: expected an object"] };
  }
  if (obj.schema !== RUN_SCHEMA) {
    errs.push(`schema: expected "${RUN_SCHEMA}", got ${JSON.stringify(obj.schema)}`);
  }
  checkType(errs, "run", obj.run, isString, "ISO string");
  checkType(errs, "ticket", obj.ticket, isString, "string");
  checkEnum(errs, "topology", obj.topology, TOPOLOGIES);
  checkType(errs, "bundle", obj.bundle, isString, 'string ("inline" or a path)');
  checkEnum(errs, "status", obj.status, RUN_STATUSES);
  checkType(errs, "updated", obj.updated, isString, "ISO string");

  if (checkArray(errs, "active_members", obj.active_members)) {
    obj.active_members.forEach((am, i) => {
      const p = `active_members[${i}]`;
      checkType(errs, `${p}.id`, am && am.id, isString, "string");
      checkType(errs, `${p}.path`, am && am.path, isString, "string");
      checkType(errs, `${p}.baseline`, am && am.baseline, isString, "git sha string");
    });
  }
  checkArray(errs, "execution_order", obj.execution_order);

  if (checkArray(errs, "tasks", obj.tasks)) {
    obj.tasks.forEach((t, i) => validateTask(errs, `tasks[${i}]`, t));
  }

  if (!(obj.integration_review === null || isString(obj.integration_review))) {
    errs.push("integration_review: expected string|null");
  }
  return { valid: errs.length === 0, errors: errs };
}

function validateTask(errs, p, t) {
  if (t == null || typeof t !== "object") { errs.push(`${p}: expected an object`); return; }
  checkType(errs, `${p}.id`, t.id, isString, "string");
  checkType(errs, `${p}.repo`, t.repo, isString, "member id string");
  checkEnum(errs, `${p}.status`, t.status, TASK_STATUSES);
  checkType(errs, `${p}.engineer_report`, t.engineer_report, isStringOrNull, "string|null");
  checkType(errs, `${p}.review`, t.review, isStringOrNull, "string|null");
  checkEnum(errs, `${p}.verdict`, t.verdict, VERDICTS);
  checkType(errs, `${p}.user_verified`, t.user_verified, isBool, "boolean");
  checkType(errs, `${p}.fix_rounds`, t.fix_rounds, isInt, "integer");
  if (t.gates_observed == null || typeof t.gates_observed !== "object") {
    errs.push(`${p}.gates_observed: expected an object`);
  } else {
    for (const k of GATE_KEYS) {
      checkEnum(errs, `${p}.gates_observed.${k}`, t.gates_observed[k], GATE_RESULTS);
    }
  }
}
