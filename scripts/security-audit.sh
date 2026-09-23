#!/usr/bin/env bash
# Deterministic npm audit gate (critical/high only). No auto-fix.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

LOCKFILE="$ROOT/package-lock.json"
REPORT="$ROOT/security-audit-report.md"

if [[ ! -f "$LOCKFILE" ]]; then
  echo "error: package-lock.json not found at $LOCKFILE" >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required to parse npm audit JSON" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "error: npm is required" >&2
  exit 1
fi

NPM_VERSION="$(npm --version 2>/dev/null || echo unknown)"
TIMESTAMP_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

AUDIT_JSON="$(mktemp)"
trap 'rm -f "$AUDIT_JSON"' EXIT

set +e
npm audit --omit=dev --json >"$AUDIT_JSON" 2>/dev/null
set -e

if [[ ! -s "$AUDIT_JSON" ]] || ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$AUDIT_JSON" 2>/dev/null; then
  set +e
  npm audit --json >"$AUDIT_JSON" 2>/dev/null
  set -e
fi

if [[ ! -s "$AUDIT_JSON" ]] || ! node -e 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"))' "$AUDIT_JSON" 2>/dev/null; then
  echo "error: npm audit did not produce valid JSON" >&2
  exit 1
fi

export AUDIT_JSON_PATH="$AUDIT_JSON"
export EXPORT_ROOT="$ROOT"
export EXPORT_LOCK="$LOCKFILE"
export EXPORT_REPORT="$REPORT"
export EXPORT_NPM="$NPM_VERSION"
export EXPORT_TS="$TIMESTAMP_UTC"

# Parse JSON, write markdown to stdout + report file; exit 0 or 2.
node <<'NODE'
const fs = require('fs');

const root = process.env.EXPORT_ROOT;
const lockPath = process.env.EXPORT_LOCK;
const reportPath = process.env.EXPORT_REPORT;
const npmVersion = process.env.EXPORT_NPM;
const timestamp = process.env.EXPORT_TS;
const data = JSON.parse(fs.readFileSync(process.env.AUDIT_JSON_PATH, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

const rootPkg = (lock.packages && lock.packages['']) || {};
const directDeps = new Set([
  ...Object.keys(rootPkg.dependencies || {}),
  ...Object.keys(rootPkg.optionalDependencies || {}),
  ...Object.keys(lock.dependencies || {}),
]);

const findings = new Map();

function addFinding(f) {
  const key = `${f.ghsa || f.url || f.title}::${f.package}`;
  if (!findings.has(key)) findings.set(key, f);
}

function isHighOrCritical(sev) {
  const s = String(sev || '').toLowerCase();
  return s === 'critical' || s === 'high';
}

function fixLabel(fixAvailable, name) {
  if (!fixAvailable) return 'no';
  if (typeof fixAvailable === 'object') {
    return `${fixAvailable.name || name}@${fixAvailable.version || '?'}`;
  }
  return 'yes';
}

for (const [name, v] of Object.entries(data.vulnerabilities || {})) {
  if (!isHighOrCritical(v.severity)) continue;
  const via = Array.isArray(v.via) ? v.via : [];
  let added = false;
  for (const item of via) {
    if (typeof item === 'string') continue;
    if (!isHighOrCritical(item.severity || v.severity)) continue;
    added = true;
    const url = item.url || '';
    addFinding({
      severity: item.severity || v.severity,
      package: name,
      title: item.title || v.name || name,
      url,
      ghsa: url.includes('GHSA') ? url.split('/').pop() : (item.source != null ? String(item.source) : ''),
      isDirect: directDeps.has(name) || Boolean(v.isDirect),
      range: item.range || v.range || '',
      fixAvailable: fixLabel(v.fixAvailable, name),
    });
  }
  if (!added) {
    addFinding({
      severity: v.severity,
      package: name,
      title: v.name || name,
      url: '',
      ghsa: '',
      isDirect: directDeps.has(name) || Boolean(v.isDirect),
      range: v.range || '',
      fixAvailable: fixLabel(v.fixAvailable, name),
    });
  }
}

for (const adv of Object.values(data.advisories || {})) {
  if (!isHighOrCritical(adv.severity)) continue;
  const pkg = adv.module_name || adv.package || 'unknown';
  addFinding({
    severity: adv.severity,
    package: pkg,
    title: adv.title || pkg,
    url: adv.url || '',
    ghsa: adv.github_advisory_id || '',
    isDirect: directDeps.has(pkg),
    range: adv.vulnerable_versions || adv.range || '',
    fixAvailable: adv.patched_versions && adv.patched_versions !== '<0.0.0'
      ? adv.patched_versions
      : 'no',
  });
}

const list = [...findings.values()].sort((a, b) => {
  const rank = { critical: 0, high: 1 };
  return (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || a.package.localeCompare(b.package);
});

const result = list.length === 0 ? 'NO ACTION' : 'ACTION REQUIRED';
const lines = [
  '# Security audit',
  `- repo: \`${root}\``,
  `- lockfile: \`${lockPath}\``,
  `- timestamp (UTC): ${timestamp}`,
  `- npm version: ${npmVersion}`,
  `- result: **${result}**`,
  '',
  '## Findings (critical/high)',
  '',
];

if (list.length === 0) {
  lines.push('No critical or high vulnerabilities.');
} else {
  for (const f of list) {
    lines.push(`### ${f.package} (${f.severity})`);
    lines.push(`- title: ${f.title}`);
    lines.push(`- advisory: ${f.url || f.ghsa || 'n/a'}`);
    lines.push(`- isDirect: ${f.isDirect}`);
    lines.push(`- range: ${f.range || 'n/a'}`);
    lines.push(`- fixAvailable: ${f.fixAvailable}`);
    lines.push('');
  }
}

const md = lines.join('\n') + '\n';
fs.writeFileSync(reportPath, md);
process.stdout.write(md);
process.exit(list.length === 0 ? 0 : 2);
NODE
