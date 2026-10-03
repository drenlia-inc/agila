#!/usr/bin/env node
/**
 * CI npm audit: fail on high+ findings in production dependencies.
 * Dev-only highs do not fail the job. braces (Tailwind's watcher) and
 * http-cache-semantics (@npmcli/arborist) have no patched release, and the
 * suggested fixes are a Tailwind 4 migration and an arborist downgrade.
 * Skip (exit 0) when the registry audit API is down.
 */
import { spawnSync } from 'child_process';

const AUDIT_UNAVAILABLE = [
  /503 Service Unavailable/i,
  /audit endpoint returned an error/i,
  /\{ error: 'Service Unavailable' \}/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /socket hang up/i
];

const result = spawnSync('npm', ['audit', '--omit=dev', '--audit-level=high'], {
  encoding: 'utf8'
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

const combined = `${result.stdout || ''}${result.stderr || ''}${result.error ? `\n${result.error.message}` : ''}`;
const registryDown =
  result.error ||
  result.status === null ||
  AUDIT_UNAVAILABLE.some((re) => re.test(combined));

if (registryDown) {
  console.warn(
    'npm audit registry unavailable; skipping this check (not a vulnerability finding).'
  );
  process.exit(0);
}

process.exit(result.status ?? 1);
