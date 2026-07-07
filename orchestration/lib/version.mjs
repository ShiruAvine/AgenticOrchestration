#!/usr/bin/env node
// Plugin-version helper. Every derived profile records `plugin_version` (the
// plugin version that produced it — stamped by detect.mjs). This module reads the
// installed plugin version and grades the gap between a profile's stamped version and
// the installed one, so `show`/`update` (and, later, the hooks) can report how urgent
// a refresh is. Schema validity is the HARD "must re-derive" signal (see readiness.mjs);
// this version gap is the SOFT "how far behind" signal.
//
// Verbs:
//   node version.mjs current                 → prints the installed plugin version
//   node version.mjs check <profile.json>    → prints stored/current/level/action

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The plugin version is single-sourced from .claude-plugin/plugin.json (sibling of lib/).
export function pluginVersion() {
  try {
    const p = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".claude-plugin", "plugin.json");
    const v = JSON.parse(fs.readFileSync(p, "utf8")).version;
    return typeof v === "string" ? v : null;
  } catch { return null; }
}

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(v || ""));
  return m ? { major: +m[1], minor: +m[2], patch: +m[3] } : null;
}

// Grade the gap between a profile's stamped version and the installed plugin version.
// Levels: current | patch | minor | major | ahead | unknown.
export function versionSeverity(stored, current = pluginVersion()) {
  if (!stored) return { level: "unknown", stored: null, current, action: "refresh recommended — profile predates version tracking (run /orchestrate-config update)" };
  const s = parseSemver(stored), c = parseSemver(current);
  if (!s || !c) return { level: "unknown", stored, current, action: "unable to compare versions" };
  if (s.major === c.major && s.minor === c.minor && s.patch === c.patch)
    return { level: "current", stored, current, action: "up to date" };
  const newer = c.major !== s.major ? c.major > s.major
    : c.minor !== s.minor ? c.minor > s.minor
    : c.patch > s.patch;
  if (!newer) return { level: "ahead", stored, current, action: "profile was written by a NEWER plugin than installed — update the plugin itself" };
  if (s.major !== c.major) return { level: "major", stored, current, action: "reconfigure recommended — run /orchestrate-config update and review carefully (a major change may add decisions)" };
  if (s.minor !== c.minor) return { level: "minor", stored, current, action: "refresh recommended — run /orchestrate-config update" };
  return { level: "patch", stored, current, action: "optional refresh — run /orchestrate-config update when convenient" };
}

// fileURLToPath (not URL.pathname): the latter yields "/E:/..." on Windows.
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [verb, file] = process.argv.slice(2);
  if (verb === "current") {
    process.stdout.write((pluginVersion() || "unknown") + "\n");
  } else if (verb === "check") {
    if (!file) { process.stderr.write("usage: version.mjs check <profile.json>\n"); process.exit(1); }
    let stored = null;
    try { stored = JSON.parse(fs.readFileSync(file, "utf8")).plugin_version || null; }
    catch (e) { process.stderr.write(`cannot read/parse ${file}: ${e.message}\n`); process.exit(1); }
    const r = versionSeverity(stored);
    process.stdout.write(`profile: ${r.stored ?? "(none)"}   installed: ${r.current ?? "unknown"}   severity: ${r.level}\n${r.action}\n`);
  } else {
    process.stderr.write("usage: version.mjs <current|check> [profile.json]\n"); process.exit(1);
  }
}
