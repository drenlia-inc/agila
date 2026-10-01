/**
 * Build docs/api/openapi.yaml from Express route registrations.
 * Usage: node scripts/generate-api-v1-openapi.mjs [--check]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'docs/api/openapi.yaml');

/** Mounts exposed at /api/v1 plus public routes that stay on /api. */
const mounts = [
  ['routes/apiV1Relay.js', '/api/v1'],
  ['routes/members.js', '/api/v1/members'],
  ['routes/boards.js', '/api/v1/boards'],
  ['routes/columns.js', '/api/v1/columns'],
  ['routes/tasks.js', '/api/v1/tasks'],
  ['routes/views.js', '/api/v1/views'],
  ['routes/reports.js', '/api/v1/reports'],
  ['routes/sprints.js', '/api/v1/admin/sprints'],
  ['routes/comments.js', '/api/v1/comments'],
  ['routes/users.js', '/api/v1/users'],
  ['routes/users.js', '/api/v1/user'],
  ['routes/upload.js', '/api/v1/upload'],
  ['routes/files.js', '/api/v1/files'],
  ['routes/files.js', '/api/v1/attachments'],
  ['routes/adminUsers.js', '/api/v1/admin/users'],
  ['routes/tags.js', '/api/v1/tags'],
  ['routes/tags.js', '/api/v1/admin/tags'],
  ['routes/priorities.js', '/api/v1/priorities'],
  ['routes/priorities.js', '/api/v1/admin/priorities'],
  ['routes/settings.js', '/api/v1/settings'],
  ['routes/settings.js', '/api/v1/admin/settings'],
  ['routes/settings.js', '/api/v1/storage'],
  ['routes/adminSystem.js', '/api/v1/admin'],
  ['routes/adminNotificationQueue.js', '/api/v1/admin/notification-queue'],
  ['routes/adminWebhooks.js', '/api/v1/admin/webhooks'],
  ['routes/adminLifecycle.js', '/api/v1/admin/lifecycle'],
  ['routes/cspReport.js', '/api/v1/admin/csp-reports'],
  ['routes/taskWork.js', '/api/v1/tasks'],
  ['routes/taskRelations.js', '/api/v1/tasks'],
  ['routes/acceptanceCriteria.js', '/api/v1/tasks'],
  ['routes/agent.js', '/api/v1/agent'],
  ['routes/helpAssistant.js', '/api/v1/help-assistant'],
  ['routes/userDev.js', '/api/v1/user/dev'],
  ['routes/activity.js', '/api/v1/activity'],
  ['routes/activity.js', '/api/v1/user'],
  ['routes/agentAutomation.js', '/api/agent/automation'],
  ['routes/password-reset.js', '/api/password-reset'],
  ['routes/auth.js', '/api/auth']
];

const excluded = new Set([
  '/api/auth/google/callback',
  '/api/auth/github/callback',
  '/api/auth/microsoft/callback',
  '/api/auth/m365/callback'
]);

function joinPath(prefix, routePath) {
  const left = prefix.replace(/\/$/, '');
  const right = routePath === '/' ? '' : routePath;
  const joined = `${left}${right.startsWith('/') || right === '' ? right : `/${right}`}`;
  return joined.replace(/\/+/g, '/');
}

const operations = [];
for (const [file, prefix] of mounts) {
  const text = fs.readFileSync(path.join(root, 'server', file), 'utf8');
  const re = /router\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
  let match;
  while ((match = re.exec(text))) {
    const full = joinPath(prefix, match[2]);
    if (excluded.has(full)) continue;
    if (full.includes('/google/') || full.includes('/github/') || full.includes('/microsoft/') || full.includes('/m365/')) {
      continue;
    }
    operations.push({ method: match[1], path: full, file });
  }
}

const byPath = new Map();
for (const op of operations) {
  if (!byPath.has(op.path)) byPath.set(op.path, new Map());
  byPath.get(op.path).set(op.method, op.file);
}

const lines = [];
lines.push('openapi: 3.0.3');
lines.push('info:');
lines.push('  title: Agila API');
lines.push('  version: 1.0.0');
lines.push('  description: |');
lines.push('    Agila API v1. Send `Authorization: Bearer` with a session JWT or an `ek_` token.');
lines.push('    The same handlers and permission checks as the web app apply.');
lines.push('    Relay routes add external keys, column titles, claim, and plans.');
lines.push('    OAuth callbacks are not part of this API.');
lines.push('servers:');
lines.push('  - url: /');
lines.push('paths:');

const yamlEscape = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

for (const routePath of [...byPath.keys()].sort()) {
  lines.push(`  ${routePath.includes('{') ? `"${routePath}"` : routePath}:`);
  // OpenAPI uses {param} but Express uses :param. Convert.
  const methods = byPath.get(routePath);
  for (const method of [...methods.keys()].sort()) {
    const file = methods.get(method);
    lines.push(`    ${method}:`);
    lines.push(`      summary: ${method.toUpperCase()} ${routePath}`);
    lines.push(`      description: "Implemented in server/${file}. Same rules as the web app."`);
    lines.push('      security:');
    lines.push('        - bearerAuth: []');
    lines.push('      responses:');
    lines.push("        '200':");
    lines.push('          description: Success');
    lines.push("        '400':");
    lines.push('          description: Invalid request');
    lines.push("        '401':");
    lines.push('          description: Missing or invalid token');
    lines.push("        '403':");
    lines.push('          description: Role, board access, viewer, or self-delete rule denied the call');
    lines.push("        '409':");
    lines.push('          description: Conflict, including a stale Relay claim');
  }
}

// Rewrite paths with {id} style for OpenAPI
const yaml = lines.join('\n').replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}') + '\n';
// The replace above also rewrote `openapi: 3` no, colons in keys... OH NO it will break `openapi: 3.0.3` and summary lines.
// Don't do a global replace. Rebuild properly.

function toOpenApiPath(routePath) {
  return routePath.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

const lines2 = [];
lines2.push('openapi: 3.0.3');
lines2.push('info:');
lines2.push('  title: Agila API');
lines2.push('  version: "1.0.0"');
lines2.push('  description: >');
lines2.push('    Agila API v1. Send Authorization Bearer with a session JWT or an ek_ token.');
lines2.push('    The same handlers and permission checks as the web app apply.');
lines2.push('    Relay routes add external keys, column titles, claim, and plans.');
lines2.push('    OAuth callbacks are not part of this API.');
lines2.push('servers:');
lines2.push('  - url: /');
lines2.push('components:');
lines2.push('  securitySchemes:');
lines2.push('    bearerAuth:');
lines2.push('      type: http');
lines2.push('      scheme: bearer');
lines2.push('paths:');

const openByPath = new Map();
for (const op of operations) {
  const openPath = toOpenApiPath(op.path);
  if (!openByPath.has(openPath)) openByPath.set(openPath, new Map());
  openByPath.get(openPath).set(op.method, op.file);
}

for (const routePath of [...openByPath.keys()].sort()) {
  lines2.push(`  "${routePath}":`);
  for (const method of [...openByPath.get(routePath).keys()].sort()) {
    const file = openByPath.get(routePath).get(method);
    lines2.push(`    ${method}:`);
    lines2.push(`      summary: "${method.toUpperCase()} ${yamlEscape(routePath)}"`);
    lines2.push(`      description: "Implemented in server/${file}. Same rules as the web app."`);
    lines2.push('      security:');
    lines2.push('        - bearerAuth: []');
    lines2.push('      responses:');
    lines2.push("        '200':");
    lines2.push('          description: Success');
    lines2.push("        '401':");
    lines2.push('          description: Missing or invalid token');
    lines2.push("        '403':");
    lines2.push('          description: Denied by the same rule as the web app, including admin and owner self-delete');
    lines2.push("        '409':");
    lines2.push('          description: Conflict, including a stale Relay claim');
  }
}
lines2.push('');

const generated = lines2.join('\n');
const check = process.argv.includes('--check');
if (check) {
  const current = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (current !== generated) {
    console.error('docs/api/openapi.yaml is out of date. Run: node scripts/generate-api-v1-openapi.mjs');
    process.exit(1);
  }
  console.log(`OpenAPI check ok (${operations.length} operations)`);
} else {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, generated);
  console.log(`Wrote ${operations.length} operations to docs/api/openapi.yaml`);
}
