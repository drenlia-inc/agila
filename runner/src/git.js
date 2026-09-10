/**
 * Git helpers for the coding agent.
 * Auth prefers the assigning user's GitHub PAT (HTTPS); falls back to their SSH key.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

/** Hide PATs accidentally included in git/exec error text. */
export function redactGitError(err) {
  return String(err?.message || err?.stderr || err || '')
    .replace(/x-access-token:[^@\s]+/gi, 'x-access-token:***')
    .replace(/ghp_[A-Za-z0-9]+/g, 'ghp_***')
    .replace(/github_pat_[A-Za-z0-9_]+/g, 'github_pat_***');
}

/**
 * One branch per runner job so later iterations (and leftover remote
 * branches after merge) never collide with --force-with-lease.
 * @param {{ ticket?: string, taskId?: string, jobId?: string }} opts
 */
export function agentWorkingBranchName({ ticket, taskId, jobId } = {}) {
  const base =
    String(ticket || taskId || 'task')
      .replace(/[^a-zA-Z0-9._-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'task';
  const suffix = String(jobId || '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8)
    .toLowerCase();
  return suffix ? `agent/${base}-${suffix}` : `agent/${base}`;
}

export function workspacePath(tenantId, jobId) {
  const safeTenant = String(tenantId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeJob = String(jobId || 'job').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join('/tmp/jobs', safeTenant, safeJob);
}

function authRepoUrl(repoUrl, token) {
  if (!token) return repoUrl;
  try {
    const u = new URL(repoUrl);
    if (u.hostname === 'github.com' || u.hostname.endsWith('.github.com')) {
      u.username = 'x-access-token';
      u.password = token;
      return u.toString();
    }
  } catch {
    /* keep original */
  }
  return repoUrl;
}

/** Convert https://github.com/org/repo(.git) → git@github.com:org/repo.git */
export function toSshGithubUrl(repoUrl) {
  try {
    if (/^git@github\.com:/i.test(repoUrl)) {
      return repoUrl.endsWith('.git') ? repoUrl : `${repoUrl}.git`;
    }
    const u = new URL(repoUrl);
    if (u.hostname === 'github.com' || u.hostname.endsWith('.github.com')) {
      const parts = u.pathname.replace(/^\/+/, '').replace(/\.git$/, '').split('/');
      if (parts[0] && parts[1]) {
        return `git@github.com:${parts[0]}/${parts[1]}.git`;
      }
    }
  } catch {
    /* ignore */
  }
  return repoUrl;
}

async function run(cwd, args, opts = {}) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      ...(opts.env || {})
    }
  });
  return { stdout: stdout?.toString() || '', stderr: stderr?.toString() || '' };
}

async function withSshKey(privateKey, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ek-ssh-'));
  const keyPath = path.join(dir, 'id_ed25519');
  try {
    await fs.writeFile(keyPath, privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`, {
      mode: 0o600
    });
    const gitSsh = `ssh -i ${keyPath} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${path.join(dir, 'known_hosts')}`;
    return await fn({ GIT_SSH_COMMAND: gitSsh });
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Clone repo into workspace (shallow).
 * @param {{ repoUrl: string, branch?: string, token?: string, sshPrivateKey?: string, workDir: string }} opts
 */
export async function cloneRepo({ repoUrl, branch, token, sshPrivateKey, workDir }) {
  await fs.rm(workDir, { recursive: true, force: true });
  await fs.mkdir(workDir, { recursive: true });

  const args = ['clone', '--depth', '50'];
  if (branch) {
    args.push('--branch', branch);
  }

  const runClone = async (url, envExtra = {}) => {
    await execFileAsync('git', [...args, url, workDir], {
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...envExtra }
    });
  };

  try {
    if (token) {
      await runClone(authRepoUrl(repoUrl, token));
    } else if (sshPrivateKey) {
      const sshUrl = toSshGithubUrl(repoUrl);
      await withSshKey(sshPrivateKey, (env) => runClone(sshUrl, env));
    } else {
      await runClone(repoUrl);
    }
  } catch (err) {
    const detail = `${err?.stderr || err?.message || err}`.trim();
    if (/could not read Username|Authentication failed|Permission denied|403|401/i.test(detail)) {
      throw new Error(
        `Git clone failed (auth). The assigning user needs a GitHub PAT or SSH key under Profile → Dev. Details: ${detail.slice(0, 300)}`
      );
    }
    throw err;
  }

  await run(workDir, ['config', 'user.email', 'agent@easy-kanban.local']);
  await run(workDir, ['config', 'user.name', 'Easy Kanban Agent']);
}

export async function createBranch(workDir, branchName) {
  await run(workDir, ['checkout', '-B', branchName]);
}

export async function commitAll(workDir, message) {
  await run(workDir, ['add', '-A']);
  try {
    await run(workDir, ['diff', '--cached', '--quiet']);
    return { committed: false };
  } catch {
    // diff --quiet exits 1 when there are changes
  }
  await run(workDir, ['commit', '-m', message]);
  return { committed: true };
}

export async function pushBranch(workDir, branchName, { token, sshPrivateKey, repoUrl }) {
  // New per-job branch names: a normal push is enough. Do not use
  // --force-with-lease without a fetched remote SHA (Git reports "stale info"
  // after a fresh clone of main while agent/<ticket> still exists).
  const refspec = `HEAD:${branchName}`;
  try {
    if (token) {
      const url = authRepoUrl(repoUrl, token);
      await run(workDir, ['push', '-u', url, refspec]);
      return;
    }
    if (sshPrivateKey) {
      const sshUrl = toSshGithubUrl(repoUrl);
      await withSshKey(sshPrivateKey, (env) =>
        run(workDir, ['push', '-u', sshUrl, refspec], { env })
      );
      return;
    }
  } catch (err) {
    throw new Error(redactGitError(err) || 'git push failed');
  }
  throw new Error('No GitHub credentials to push');
}

/**
 * Open a GitHub PR via API when a PAT is available.
 * If a PR for this head already exists, return that URL instead of failing.
 */
export async function openPullRequest({ repoUrl, token, head, base, title, body }) {
  if (!token) return null;
  let owner;
  let repo;
  try {
    const u = new URL(repoUrl.replace(/\.git$/, ''));
    const parts = u.pathname.replace(/^\/+/, '').split('/');
    owner = parts[0];
    repo = parts[1];
  } catch {
    return null;
  }
  if (!owner || !repo) return null;

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'easy-kanban-runner'
  };

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title,
      head,
      base: base || 'main',
      body: body || ''
    })
  });
  if (res.ok) {
    const data = await res.json();
    return data.html_url || null;
  }
  const text = await res.text().catch(() => '');
  console.warn(`[runner] PR create failed: ${res.status} ${text.slice(0, 200)}`);

  const headParam = encodeURIComponent(`${owner}:${head}`);
  const listed = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls?head=${headParam}&state=open`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'easy-kanban-runner' } }
  ).catch(() => null);
  if (listed?.ok) {
    const pulls = await listed.json().catch(() => []);
    if (Array.isArray(pulls) && pulls[0]?.html_url) {
      return pulls[0].html_url;
    }
  }
  return null;
}

export async function cleanupWorkspace(workDir) {
  try {
    await fs.rm(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
